import fs from "node:fs";
import path from "node:path";
import type { AutomationDefinition, AutomationStore } from "@innocenceharness/harness-automation";

interface AutomationDocument {
  version: 1;
  definitions: AutomationDefinition[];
}

const EMPTY_DOCUMENT: AutomationDocument = { version: 1, definitions: [] };

function clone(definition: AutomationDefinition): AutomationDefinition {
  return JSON.parse(JSON.stringify(definition)) as AutomationDefinition;
}

function readDocument(file: string): AutomationDocument {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AutomationDocument>;
    if (parsed.version !== 1 || !Array.isArray(parsed.definitions)) return EMPTY_DOCUMENT;
    return {
      version: 1,
      definitions: parsed.definitions.filter((item): item is AutomationDefinition =>
        Boolean(item) && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && item.candidate !== undefined,
      ).map(clone),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    }
    return EMPTY_DOCUMENT;
  }
}

export function createAutomationStore(file: string): AutomationStore {
  let document = readDocument(file);
  const persist = (): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(document, null, 2), "utf8");
    fs.renameSync(temporary, file);
  };
  return {
    list: () => document.definitions.map(clone),
    save: (definition) => {
      const index = document.definitions.findIndex((item) => item.id === definition.id);
      if (index >= 0) document.definitions[index] = clone(definition);
      else document.definitions.push(clone(definition));
      persist();
    },
    remove: (id) => {
      const index = document.definitions.findIndex((definition) => definition.id === id);
      if (index < 0) return false;
      document.definitions.splice(index, 1);
      persist();
      return true;
    },
  };
}
