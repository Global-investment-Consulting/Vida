#!/usr/bin/env bash
set -Eeuo pipefail

# Manual staging deployment helper for GitHub Actions.
# Orchestrates Cloud Build (via REST API) and Cloud Run deployment,
# then verifies the health endpoints on the deployed service.

main() {
  cd_repo_root
  read_inputs
  create_source_tarball
  upload_source_archive
  trigger_cloud_build
  wait_for_cloud_build
  deploy_cloud_run
  verify_health_endpoints
}

cd_repo_root() {
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cd "$repo_root"
}

read_inputs() {
  : "${PROJECT_ID:?PROJECT_ID is required}"
  : "${REGION:?REGION is required}"
  : "${SERVICE:?SERVICE is required}"
  : "${IMAGE_URI:?IMAGE_URI is required}"
  : "${JWT_SECRET:?JWT_SECRET is required}"
  : "${VIDA_API_KEYS:?VIDA_API_KEYS is required}"

  LOG_LEVEL="${LOG_LEVEL:-info}"
  NODE_ENV="${NODE_ENV:-production}"
  VIDA_AP_ADAPTER="${VIDA_AP_ADAPTER:-mock}"
  VIDA_AP_SEND_ON_CREATE="${VIDA_AP_SEND_ON_CREATE:-true}"

  # Fall back to the known staging bucket if not provided.
  CLOUD_BUILD_BUCKET="${CLOUD_BUILD_BUCKET:-vida-staging-1760866919-cb-src}"
  CLOUD_BUILD_BUCKET="${CLOUD_BUILD_BUCKET#gs://}"
  CLOUD_BUILD_BUCKET="${CLOUD_BUILD_BUCKET%%/}"
  if [[ -z "${CLOUD_BUILD_BUCKET}" ]]; then
    echo "Unable to determine Cloud Build bucket" >&2
    exit 1
  fi

  ACCESS_TOKEN="$(gcloud auth print-access-token)"
  if [[ -z "${ACCESS_TOKEN}" ]]; then
    echo "Failed to obtain access token for Cloud Build API" >&2
    exit 1
  fi

  # Guarantee a consistent run identifier for artefacts.
  RUN_ID="${GITHUB_RUN_ID:-manual-$(date +%s)}"
  BUILD_OBJECT="builds/${RUN_ID}/source.tgz"

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  ARCHIVE_PATH="${TMP_DIR}/source.tgz"

  # Prepare summary file handle if we are inside GitHub Actions.
  SUMMARY_FILE="${GITHUB_STEP_SUMMARY:-}"
}

create_source_tarball() {
  echo "Creating source archive..."
  tar --exclude='.git' \
      --exclude='node_modules' \
      --exclude='dist' \
      --exclude='.github/workflows/*.bak*' \
      --exclude='*.log' \
      -czf "$ARCHIVE_PATH" .
  echo "Archive created at $ARCHIVE_PATH ($(du -h "$ARCHIVE_PATH" | cut -f1))"
}

upload_source_archive() {
  local destination="gs://${CLOUD_BUILD_BUCKET}/${BUILD_OBJECT}"
  echo "Uploading source archive to ${destination}..."
  gcloud storage cp "$ARCHIVE_PATH" "$destination"
  echo "Upload complete."
}

trigger_cloud_build() {
  echo "Triggering Cloud Build..."
  local payload
  payload="$(jq -n \
    --arg bucket "$CLOUD_BUILD_BUCKET" \
    --arg object "$BUILD_OBJECT" \
    --arg image "$IMAGE_URI" \
    '{
      source: { storageSource: { bucket: $bucket, object: $object } },
      steps: [
        { name: "gcr.io/cloud-builders/docker", args: ["build", "-t", $image, "."] },
        { name: "gcr.io/cloud-builders/docker", args: ["push", $image] }
      ],
      images: [$image],
      options: { logging: "CLOUD_LOGGING_ONLY" },
      timeout: "1200s",
      tags: ["staging", "github-actions"]
    }')"

  local response
  response="$(curl -sfSL \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/builds")" || {
      echo "Failed to create Cloud Build:"
      echo "$response"
      exit 1
    }

  OPERATION_NAME="$(jq -r '.name' <<<"$response")"
  BUILD_ID="$(jq -r '.metadata.build.id' <<<"$response")"
  BUILD_LOG_URL="$(jq -r '.metadata.build.logUrl' <<<"$response")"

  if [[ -z "$OPERATION_NAME" || "$OPERATION_NAME" == "null" ]]; then
    echo "Could not determine Cloud Build operation name" >&2
    echo "$response"
    exit 1
  fi

  echo "Cloud Build ID: ${BUILD_ID:-<unknown>}"
  echo "Cloud Build logs: ${BUILD_LOG_URL:-<unavailable>}"

  append_summary "Cloud Build ID: ${BUILD_ID:-unknown}"
  append_summary "Cloud Build logs: ${BUILD_LOG_URL:-unavailable}"
}

wait_for_cloud_build() {
  echo "Waiting for Cloud Build operation: $OPERATION_NAME"
  local status="UNKNOWN"
  local done=false

  for attempt in {1..120}; do
    local poll=""
    if ! poll="$(curl -sfSL \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      "https://cloudbuild.googleapis.com/v1/${OPERATION_NAME}")"; then
      echo "Empty response from Cloud Build API, retrying..."
      sleep 5
      continue
    fi

    done="$(jq -r '.done // false' <<<"$poll")"
    status="$(jq -r '.metadata.build.status // .response.status // "UNKNOWN"' <<<"$poll")"

    echo "Cloud Build status: $status"

    if [[ "$done" == "true" ]]; then
      if [[ "$status" != "SUCCESS" ]]; then
        echo "Cloud Build failed:"
        echo "$poll" | jq '.error // .response'
        exit 1
      fi
      BUILD_ID="$(jq -r '.response.id // .metadata.build.id // empty' <<<"$poll")" || true
      BUILD_LOG_URL="$(jq -r '.response.logUrl // .metadata.build.logUrl // empty' <<<"$poll")" || true
      append_summary "Cloud Build status: $status"
      return
    fi
    sleep 5
  done

  echo "Cloud Build operation timed out waiting for completion" >&2
  exit 1
}

deploy_cloud_run() {
  echo "Deploying image ${IMAGE_URI} to Cloud Run service ${SERVICE} (${REGION})..."
  gcloud run deploy "$SERVICE" \
    --image "$IMAGE_URI" \
    --region "$REGION" \
    --allow-unauthenticated \
    --set-env-vars "JWT_SECRET=${JWT_SECRET},PEPPOL_MODE=sandbox,VIDA_API_KEYS=${VIDA_API_KEYS},LOG_LEVEL=${LOG_LEVEL},NODE_ENV=${NODE_ENV},VIDA_AP_ADAPTER=${VIDA_AP_ADAPTER},VIDA_AP_SEND_ON_CREATE=${VIDA_AP_SEND_ON_CREATE}" \
    --timeout=600s

  SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
  if [[ -z "$SERVICE_URL" ]]; then
    echo "Unable to determine service URL after deployment" >&2
    exit 1
  fi

  echo "Service URL: $SERVICE_URL"
  append_summary "Service URL: $SERVICE_URL"
}

verify_health_endpoints() {
  echo "Verifying service health endpoints..."
  local endpoints=("/_health" "/health" "/healthz/")
  local failures=0

  for path in "${endpoints[@]}"; do
    local url="${SERVICE_URL}${path}"
    local status
    status="$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")"
    echo "GET ${url} -> HTTP ${status}"
    append_summary "GET ${path}: ${status}"
    if [[ "$status" != "200" ]]; then
      failures=$((failures + 1))
    fi
  done

  if (( failures > 0 )); then
    echo "Health check failed for ${failures} endpoint(s)" >&2
    exit 1
  fi
}

append_summary() {
  local message="$1"
  if [[ -n "${SUMMARY_FILE}" ]]; then
    echo "$message" >> "$SUMMARY_FILE"
  fi
}

main "$@"
