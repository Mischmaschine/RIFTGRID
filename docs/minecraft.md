# Minecraft adapter

The first adapter supports Paper and Vanilla. It validates version/resource/EULA input and emits a normalized workload using `itzg/minecraft-server`. `/data` is persisted, so stop/start and rescheduling retain the world. Paper's Query endpoint is used as the application health signal; console commands use the pod stdin/RCON execution path exposed only through authenticated RIFTGRID APIs.
