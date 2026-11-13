// Entry point: wiring, poll loop, graceful shutdown on SIGTERM/SIGINT.

import { setTimeout as sleep } from "node:timers/promises";
import { Announcer, freshState } from "./announcer.js";
import { AvatarSync, type AvatarUpdater } from "./avatar.js";
import { ChainClient } from "./chain.js";
import { ConfigError, loadConfig, type BotConfig } from "./config.js";
import { errorFields, log, setLogLevel } from "./log.js";
import { DryRunAvatarUpdater, DryRunPublisher, XAvatarUpdater, XPublisher, type Publisher } from "./publish.js";
import { loadState, saveState } from "./state.js";
import { XClient } from "./x.js";

const MS_PER_SECOND = 1000;
const EXIT_CONFIG_ERROR = 78; // EX_CONFIG: systemd's RestartPreventExitStatus stops crash loops.
const EXIT_FAILURE = 1;

function makePublisher(config: BotConfig): Publisher {
  if (config.dryRun || config.x === null) return new DryRunPublisher(config.outDir);
  return new XPublisher(new XClient(config.x));
}

function makeAvatarUpdater(config: BotConfig): AvatarUpdater {
  if (config.dryRun || config.x === null) return new DryRunAvatarUpdater(config.outDir);
  return new XAvatarUpdater(new XClient(config.x));
}

async function run(config: BotConfig, stop: AbortSignal): Promise<void> {
  const chain = new ChainClient(config.rpcUrl, config.contractId);
  const [catalog, contractConfig] = await Promise.all([chain.catalog(), chain.config()]);

  let state = await loadState(config.stateFile);
  if (state === null) {
    state = await freshState(chain);
    await saveState(config.stateFile, state);
    log.info("first start: cursor set to the newest journal entry", { cursor_ns: state.cursorNs.toString() });
  }

  const announcer = new Announcer(
    {
      chain,
      publisher: makePublisher(config),
      persist: (next) => saveState(config.stateFile, next),
      catalog,
      auctionBurnBps: contractConfig.auction_burn_bps,
      minPostIntervalSeconds: config.minPostIntervalSeconds,
      compose: { publicUrl: config.publicUrl },
    },
    state,
  );
  const avatar = new AvatarSync(chain, makeAvatarUpdater(config));
  log.info("shed-bot started", {
    contract: config.contractId,
    dry_run: config.dryRun,
    poll_seconds: config.pollSeconds,
    cursor_ns: state.cursorNs.toString(),
    pending_transforms: state.pendingTransforms.length,
  });

  while (!stop.aborted) {
    try {
      await announcer.tick();
    } catch (error) {
      // RPC hiccups and similar: keep the cursor where it was and retry on the next poll.
      log.error("poll failed", errorFields(error));
    }
    // Separate from announcements: a profile picture failure must never hold the cursor back.
    try {
      await avatar.tick();
    } catch (error) {
      log.error("profile picture sync failed", errorFields(error));
    }
    await sleep(config.pollSeconds * MS_PER_SECOND, undefined, { signal: stop }).catch((error: unknown) => {
      if (!stop.aborted) throw error;
    });
  }
  log.info("shed-bot stopped", { cursor_ns: announcer.current.cursorNs.toString() });
}

async function main(): Promise<void> {
  let config: BotConfig;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    log.error(error.message);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  setLogLevel(config.logLevel);

  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      log.info("shutdown requested", { signal });
      controller.abort();
    });
  }
  await run(config, controller.signal);
}

main().catch((error: unknown) => {
  log.error("fatal", errorFields(error));
  process.exitCode = EXIT_FAILURE;
});
