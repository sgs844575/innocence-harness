export async function startSkillCreation(target: string | null, ports: {
  selectMode(): Promise<void>;
  openChat(target: string | null): void;
}): Promise<void> {
  await ports.selectMode();
  ports.openChat(target);
}
