---
layout: post
title:  "Rancher in LXC on Proxmox - The container matroska"
date:   2021-03-10 17:00:00 +0100
categories: it
lang: en
---

As I had a lot of trouble running, rancher within a LXC container on proxmox I wanted to share my solution.

When rancher is started, it requires to be run in priviliged mode. It determents if has been started in priviliged mode
by checking for `/dev/kmsg` but its never mentioned. So the final soulution is, to not only create a priviliged LXC
container, but to also ensure that `/dev/kmsg` is available in the container, which is not the default.

For this, following entries in the container configuration on Proxmox are required:

```
lxc.apparmor.profile: unconfined
lxc.cap.drop:
lxc.cgroup.devices.allow: a
lxc.mount.auto: proc:rw sys:rw
lxc.mount.entry: /dev/kmsg dev/kmsg none defaults,bind,create=file
```

After you created a priviliged LXC container and added the configuration you can install docker and run rancher inside
the container.
