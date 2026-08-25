import path from "node:path";

export type ExternalUiRuntime = {
  entry: string;
  packaged: boolean;
  source: "development" | "explicit-package" | "default-package";
};

export type ExternalUiRuntimeSelection =
  | { status: "available"; runtime: ExternalUiRuntime }
  | { status: "unavailable"; reason: string };

export type ExternalUiRuntimeSelectionInput = {
  defaultPackageDirectory: string;
  developmentEntry?: string;
  executableName: string;
  isExecutable: (entry: string) => boolean;
  requestedPackageDirectory?: string;
  runtimeDisabled?: boolean;
};

function packagedRuntime(
  packageDirectory: string,
  source: Extract<ExternalUiRuntime["source"], "explicit-package" | "default-package">,
  input: ExternalUiRuntimeSelectionInput,
): ExternalUiRuntimeSelection {
  const entry = path.join(packageDirectory, input.executableName);
  if (input.isExecutable(entry)) {
    return { status: "available", runtime: { entry, packaged: true, source } };
  }
  const qualifier = source === "explicit-package" ? "explicit" : "default";
  return {
    status: "unavailable",
    reason: `${qualifier} packaged runtime executable not found or not executable: ${entry}`,
  };
}

export function selectExternalUiRuntime(input: ExternalUiRuntimeSelectionInput): ExternalUiRuntimeSelection {
  if (input.runtimeDisabled) {
    return { status: "unavailable", reason: "desktop runtime disabled by test configuration" };
  }
  if (input.requestedPackageDirectory !== undefined && input.requestedPackageDirectory !== "") {
    return packagedRuntime(input.requestedPackageDirectory, "explicit-package", input);
  }
  if (input.developmentEntry !== undefined) {
    return {
      status: "available",
      runtime: { entry: input.developmentEntry, packaged: false, source: "development" },
    };
  }
  return packagedRuntime(input.defaultPackageDirectory, "default-package", input);
}
