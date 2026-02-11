const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(value) {
  const level = String(value || 'info')
    .trim()
    .toLowerCase();
  return LEVELS[level] ? level : 'info';
}

function shouldLog(eventLevel, runtimeLevel) {
  return LEVELS[eventLevel] >= LEVELS[runtimeLevel];
}

function pruneUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function writeLog(level, message, fields = {}) {
  const runtimeLevel = normalizeLevel(process.env.LOG_LEVEL);
  if (!shouldLog(level, runtimeLevel)) return;

  const payload = pruneUndefined({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields
  });

  const line = `${JSON.stringify(payload)}\n`;
  if (level === 'error') {
    process.stderr.write(line);
    return;
  }
  process.stdout.write(line);
}

module.exports = {
  writeLog
};
