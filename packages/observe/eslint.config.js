import root from "../../eslint.config.js";

const pipelineRunImportBlocks = [
  "#run/worker/**",
  "#run/kernel.js",
  "#run/run.js",
  "#run/store.js",
  "#run/control/board/model.js",
  "#run/control/catalog.js",
  "#run/control/board/**",
  "#run/control/system/**",
  "#run/control/bus/bus.js",
  "#run/control/bus/registry.js",
  "#run/control/bus/artifacts.js",
  "#run/control/bus/subscriptions.js",
  "#run/control/bus/index.js",
  "#run/control/state.js",
  "#run/control/commands.js",
  "#run/control/targets/**"
];

const runBrowserControlImportBlocks = ["#pipeline/capture/browser/control/**"];

export default [
  ...root,
  {
    ignores: ["dist/**"]
  },
  {
    files: ["src/pipeline/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: pipelineRunImportBlocks,
              message:
                "Pipeline may import only #run/control/bus/calls.js and #run/control/bus/types.js from run."
            },
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message:
                "Use #/* imports (e.g. #pipeline/..., #run/..., #adapters/...) instead of parent-relative paths. Same-folder ./ imports are allowed."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/run/**/*.{ts,tsx}", "src/bridge/**/*.{ts,tsx}", "src/scope/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: runBrowserControlImportBlocks,
              message:
                "run, bridge, and scope must not import browser control modules from pipeline."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    ignores: ["src/pipeline/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../../*", "../../../*", "../../../../*"],
              message:
                "Use #/* imports (e.g. #pipeline/..., #run/..., #adapters/...) instead of parent-relative paths. Same-folder ./ imports are allowed."
            }
          ]
        }
      ]
    }
  }
];
