export default function register(api: {
  registerPanel(contribution: { id: string; labelKey: string; render: () => unknown }): () => void;
  registerSettingsSection(contribution: {
    id: string;
    labelKey: string;
    icon: (props: { size?: number; className?: string }) => unknown;
    render: () => unknown;
  }): () => void;
}): void {
  api.registerPanel({
    id: "fixture-panel",
    labelKey: "fixture.panel",
    render: () => "Fixture panel content",
  });
  api.registerSettingsSection({
    id: "fixture-settings",
    labelKey: "fixture.settings",
    icon: () => null,
    render: () => "Fixture settings content",
  });
}
