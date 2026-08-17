# Networking

Ports are reservations with `(node, protocol, port)` uniqueness. Allocation occurs transactionally after placement and before Service creation. Minecraft currently requests one TCP game port. Kubernetes NodePort range defaults to 30000-32767 and can be configured. Service status is observed before an address is presented as usable.
