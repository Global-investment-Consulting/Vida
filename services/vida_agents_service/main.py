import os, sys, asyncio, traceback
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

# Windows event loop policy + env
if sys.platform.startswith("win"):
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass
load_dotenv()

MODEL = os.getenv("OPENAI_AGENT_MODEL", "gpt-5")

app = FastAPI(title="ViDA Agents Service — Minimal Reset")

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/status")
def status():
    return {
        "ok": True,
        "has_openai_key": bool(os.getenv("OPENAI_API_KEY")),
        "model": MODEL,
    }

# List mounted routes so we see what FastAPI really registered
from fastapi.routing import APIRoute
@app.get("/__routes")
def list_routes():
    return {"routes": [r.path for r in app.router.routes]}

# Diagnostic: verify the SDK runs on the main loop
@app.get("/debug_error")
async def debug_error():
    try:
        from agents import Agent, Runner  # OpenAI Agents SDK
        agent = Agent(name="Ping", instructions="Return 'pong'.", model=MODEL)
        res = await Runner.run(agent, "pong please")
        return {"ok": True, "model": MODEL, "reply": (res.final_output or "").strip()}
    except Exception as e:
        return {
            "ok": False,
            "model": MODEL,
            "type": type(e).__name__,
            "msg": str(e),
            "trace": traceback.format_exc(),
        }

# Known-good async scout (NO routers, NO threads for SDK)
from agents import Agent, Runner  # SDK
async def _scout_proposal() -> str:
    agent = Agent(name="DevScout", instructions="Reply in one short sentence.", model=MODEL)
    res = await Runner.run(agent, "Say hello from the DevScout agent.")
    return (res.final_output or "").strip()

@app.post("/agents/run_scout")
async def run_scout():
    try:
        text = await _scout_proposal()
        # Optional GitHub creation AFTER we have the text (in a thread)
        meta = None
        tok, repo = os.getenv("GITHUB_TOKEN"), os.getenv("GITHUB_REPO")
        if tok and repo:
            def _create_issue():
                from github import Github
                gh = Github(tok); rp = gh.get_repo(repo)
                issue = rp.create_issue(title="[Scout] Small improvements", body=text, labels=["insights","auto"])
                return {"issue_number": issue.number, "url": issue.html_url}
            meta = await asyncio.to_thread(_create_issue)
        return {"proposal": text, "github": meta}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {e}")

# IMPORTANT: temporarily DO NOT include any routers here.
# If you normally have `from routes.agents_api import router` + `app.include_router(router)`,
# comment those out until everything returns 200.
