/**
 * Exécute une étape de pipeline avec bannières, durée et heartbeat si l’étape est longue.
 */

import { spawn } from "node:child_process";

export function formatDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/**
 * @param {object} opts
 * @param {number} opts.step
 * @param {number} opts.total
 * @param {string} opts.label
 * @param {string} opts.cmd
 * @param {string[]} opts.args
 * @param {string} [opts.cwd]
 * @param {Record<string, string>} [opts.env]
 * @param {number} [opts.heartbeatSec] — message « toujours en cours » toutes les N secondes (0 = off)
 */
export function runPipelineStep(opts) {
  const {
    step,
    total,
    label,
    cmd,
    args,
    cwd,
    env = {},
    heartbeatSec = 15,
  } = opts;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const startedIso = new Date().toISOString();
    const shortCmd = [cmd, ...args].join(" ").slice(0, 120);

    console.error("");
    console.error(`━━━ [${step}/${total}] ${label} ━━━`);
    console.error(`    démarré : ${startedIso}`);
    if (shortCmd) console.error(`    ${shortCmd}${shortCmd.length >= 120 ? "…" : ""}`);

    const childEnv = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      ...env,
    };

    const isPython = /python(?:3(?:\.\d+)?)?$/.test(cmd);
    const spawnArgs = isPython ? ["-u", ...args] : args;

    const child = spawn(cmd, spawnArgs, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let lastLineAt = Date.now();
    const onChunk = (chunk, isErr) => {
      lastLineAt = Date.now();
      const sink = isErr ? process.stderr : process.stdout;
      sink.write(chunk);
    };
    child.stdout?.on("data", (c) => onChunk(c, false));
    child.stderr?.on("data", (c) => onChunk(c, true));

    const heartbeat =
      heartbeatSec > 0
        ? setInterval(() => {
            const elapsed = formatDuration(Date.now() - startedAt);
            const sinceOutput = formatDuration(Date.now() - lastLineAt);
            console.error(
              `    ⏳ ${label} — ${elapsed} écoulées` +
                (Date.now() - lastLineAt > heartbeatSec * 1000
                  ? ` (dernière sortie il y a ${sinceOutput})`
                  : "")
            );
          }, heartbeatSec * 1000)
        : null;

    child.on("error", (err) => {
      if (heartbeat) clearInterval(heartbeat);
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (heartbeat) clearInterval(heartbeat);
      const elapsed = formatDuration(Date.now() - startedAt);
      if (code !== 0) {
        console.error(
          `    ✗ échec après ${elapsed}` +
            (code != null ? ` (code ${code})` : "") +
            (signal ? ` signal ${signal}` : "")
        );
        reject(new Error(`${label} a échoué`));
        return;
      }
      console.error(`    ✓ terminé en ${elapsed}`);
      resolve();
    });
  });
}
