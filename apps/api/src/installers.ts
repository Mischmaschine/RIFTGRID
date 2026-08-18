import { CustomDockerInstaller, FiveMInstaller, InstallerRegistry, RustInstaller, ValheimInstaller } from "@riftgrid/game-sdk";
import { MinecraftInstaller } from "@riftgrid/game-minecraft";

export function createInstallerRegistry(): InstallerRegistry {
  return new InstallerRegistry()
    .register(new MinecraftInstaller())
    .register(new CustomDockerInstaller())
    .register(new FiveMInstaller())
    .register(new RustInstaller())
    .register(new ValheimInstaller());
}
