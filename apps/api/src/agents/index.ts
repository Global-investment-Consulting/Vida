const normalizeBoolean = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export function isAgentsEnabled(): boolean {
  return normalizeBoolean(process.env.AGENTS_ENABLED);
}

export function logAgentsAvailability(logger: Pick<typeof console, 'info'> = console): void {
  if (isAgentsEnabled()) {
    logger.info('[agents] OpenAI Agents feature flag enabled (AGENTS_ENABLED=true)');
  } else {
    logger.info('[agents] OpenAI Agents feature flag disabled');
  }
}
