// Deployment metadata surfaced to the DM.
// Populated from build-time env vars baked in by the Dockerfile
// (GIT_SHA, GIT_SUBJECT). Falls back to "unknown" so dev/test runs
// never crash on a missing value.

export function getDeploymentInfo(env = process.env) {
  const sha = (env.GIT_SHA || 'unknown').trim();
  const subject = (env.GIT_SUBJECT || 'unknown').trim();
  return {
    sha: sha.slice(0, 40),
    shortSha: sha === 'unknown' ? 'unknown' : sha.slice(0, 7),
    subject: subject.slice(0, 200),
  };
}

// Path inside the container where update requests are dropped.
// A host-side watcher polls this directory and runs update.sh
// on a schedule (see update.sh / DSM Task Scheduler).
export const TRIGGER_DIR = '/app/triggers';

export function buildTriggerFilename(now = Date.now(), rand = Math.random) {
  const tag = Math.floor(rand() * 1e6).toString(36);
  return `update-${now}-${tag}.req`;
}
