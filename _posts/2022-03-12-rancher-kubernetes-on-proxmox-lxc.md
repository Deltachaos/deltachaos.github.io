---
layout: post
title:  "Kubernetes Rancher in LXC on Proxmox - The container matroska part 2"
date:   2022-03-12 17:00:00 +0100
categories: it
lang: en
---

About one year ago I have written an article on how to get Racher running in an LXC container on a Proxmox node. I
managed to get it running and described the required steps in [this article](/it/2021/03/10/rancher-in-lxc.html).

What I did not manage to get running was adding a cluster in Rancher using LXC nodes. I left the topic aside and moved
on to other things. I had a lot of other projects in the meantime with Rachner and Kubernetes in general, and now wanted
to finally start using it for my own infrastructure.

Sure I could have accepted that Kubernetes is not running in LXC and used KVM based nodes to run a cluster.
But I did not. There must be a way. Others are running Kubernetes as well in LXC containers. And resource usage, as well
as backup is so much more efficient when using LXC containers.

## No final success (yet)

Before you expect to find the final solution in this blog post, I must disappoint you. I have solved
a few problems so far but still did not manage to bring up a final cluster (yet). If you have any
ideas after reading this, how to get it done, please let me know.

The problem I was facing at the end is, that I was stuck at the error
"network plugin is not ready: cni config uninitialized".

## The reason for the problems

The main difference between KVM and LXC is that containers are sharing the kernel with the host. Also there is no
virtualization of devices. It behaves more like an advanced `chroot`. This means access to `/proc`, `/sys` and `/dev` is
limited. Additionally the container lacks a lot of kernel capabilities by default. Loading of kernel modules cannot be
done inside of the container, but rather needs to be done on the host.

## Docker requirements

Ranchers RKE1 (which is still the only available stable version as of the date of this post), is still using docker as
container runtime, even though this has been deprecated by the Kubernetes project. But as this is still the case, we
need to meat the docker requirements first, in order to proceed to the next step.

Docker requires a few kernel modules to be enabled. Those are `overlayfs` and `aufs`. We will see some other
required kernel modules later on as well, but lets keep it to those for now. Docker normally would load the modules for
us, but as this is not permitted within the LXC container, we need to do it ourself.

Executing following commands should do the trick.

```
modprobe aufs
modprobe overlay
```

To ensure they are loaded on boot of the system the cleanest way is to create a file in `/etc/modules-load.d`.

```
cat > /etc/modules-load.d/docker.conf <<EOF
aufs
overlay
EOF
```

Now let's create a container on the proxmox host. In my case it has the id `100`, is using Ubuntu 20.04 as base image,
has `mgmt1.n.dev.localhost` as hostname. Make sure to adjust the network configuration to your network.

```
pct create 100 local:vztmpl/ubuntu-20.04-standard_20.04-1_amd64.tar.gz --cores 4 --memory 4096 --swap 2048 --hostname mgmt1.n.dev.localhost --rootfs local:20 --net0 name=eth0,ip=192.168.0.100/24,bridge=vmbr10,gw=192.168.0.1 --onboot 1
```

In order to run `docker` inside of the container, the container needs to be privileged. This is the case, if you don't
especially create the containers as unprivileged in Proxmox. This alone does not give us enough permissions, we need to
enable the nesting feature in LXC as well.

```
pct set 100 --features nesting=1
```

Now we should be able to start the container, enter it, install `docker` and run a `hello-world` container.

As we don't want the container to be accessible using ssh and only use it as docker host, we remove
some unnecessary packages. Please note that the removal of apparmor is required as well.


```
pct start 100
pct enter 100
apt-get -y remove openssh-server postfix accountsservice networkd-dispatcher rsyslog cron dbus apparmor
wget -O - https://releases.rancher.com/install-docker/20.10.sh | sh
reboot
```

Please note that we install docker using the script provided by Rancher, to have be compatible with the Kubernetes
version we want to install. Feel free to check the script before you just dump it into `sh`. If you don't want to use
Kubernetes you can also install the `docker.io` package from distribution repositories.

Now `docker run hello-world` should give you:

```
root@mgmt1:~# docker run hello-world
Unable to find image 'hello-world:latest' locally
latest: Pulling from library/hello-world
2db29710123e: Pull complete 
Digest: sha256:4c5f3db4f8a54eb1e017c385f683a2de6e06f75be442dc32698c9bbe6c861edd
Status: Downloaded newer image for hello-world:latest

Hello from Docker!
This message shows that your installation appears to be working correctly.

To generate this message, Docker took the following steps:
 1. The Docker client contacted the Docker daemon.
 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.
    (amd64)
 3. The Docker daemon created a new container from that image which runs the
    executable that produces the output you are currently reading.
 4. The Docker daemon streamed that output to the Docker client, which sent it
    to your terminal.

To try something more ambitious, you can run an Ubuntu container with:
 $ docker run -it ubuntu bash

Share images, automate workflows, and more with a free Docker ID:
 https://hub.docker.com/

For more examples and ideas, visit:
 https://docs.docker.com/get-started/
```

## Running docker containers is not enough

At some point in the rancher setup, after you have created a cluster and want to add nodes to it, you are asked to
execute something like this on the node, to bootstrap the cluster.

```
docker run -d --privileged --restart=unless-stopped --net=host -v /etc/kubernetes:/etc/kubernetes -v /var/run:/var/run  rancher/rancher-agent:v2.6.3 --server https://rancher.localhost --token <some token> --etcd --controlplane --worker
```

This basically creates a new container running `rancher-agent`, giving it full access to the docker daemon by mounting
`/var/run/docker.sock`. This lets `rancher-agent` start new containers with the Kubernetes processes on the node.

Normally you would now grab a coffee and wait 10 to 15 minutes for the node to become alive. But it's not time for
coffee yet.

You will notice that the bootstrapping of the cluster now would fail. The LXC container need more capabilities, and
permissions and modules.

I did some research on the internet and adding a few lines to the LXC config, and a few modules should do the trick.

```
modprobe ip_vs
modprobe ip_vs_rr
modprobe ip_vs_wrr
modprobe ip_vs_sh
modprobe nf_conntrack
modprobe br_netfilter
modprobe rbd
cat >> /etc/pve/lxc/100.conf <<EOF
lxc.apparmor.profile: unconfined
lxc.cgroup.devices.allow: a
lxc.cap.drop: 
lxc.mount.auto: "proc:rw sys:rw"
EOF
cat >> /etc/modules-load.d/docker.conf <<EOF
ip_vs
ip_vs_rr
ip_vs_wrr
ip_vs_sh
nf_conntrack
br_netfilter
rbd
EOF
pct stop 100
pct start 100
```

Now bootstraping fails because `/` is not shared. Ok the quick fix is to run `mount --make-rshared /` in the container.

But still, bootstrapping the node gives me some error like
`[controlPlane] Failed to upgrade Control Plane: [[host mgmt1 not ready]]`.

After running `docker ps` on the node, I noticed on container in state restarting. Looking into the logs of this
container, we notice that it did not start because `/dev/kmsg` is not available.

The problem seems familiar, as it was the same problem we had wen running Rancher in LXC. So I tried the same fix, we
did there.

```
lxc.mount.entry: /dev/kmsg dev/kmsg none defaults,bind,create=file
```

Problem seems that now `/dev/kmsg` exists, but is not readable. I did not managed to solve this problem, but found a
workaround that seems to be sufficient. Linking `/dev/kmsg` to `/dev/console`. 

So now lets make those changes persistent. Applying those changes on boot using rc.local is not pretty, but should do
the job.

```
cat > /etc/rc.local <<EOF
#!/bin/sh -e

if [ ! -e /dev/kmsg ]; then
    ln -s /dev/console /dev/kmsg
fi

mount --make-rshared /
EOF
chmod +x /etc/rc.local
/etc/rc.local
```

## Access to sysctl

Even after those changes, we see one container failing. Looking into it, you see that Kubernetes wants to change
`net.netfilter.nf_conntrack_max`, as the value configured by default in Proxmox is too low.

In my case I had to change it to at least `786432`. The strange thing is, I thought that using `proc:rw sys:rw` would
allow write access to those settings. But this seems not to be the case. Those need to be changed on the host.

I changed the value and tried again. Long story short, those are the settings that need to be changed:

```
cat > /etc/sysctl.d/100-docker.conf  <<EOF
net.netfilter.nf_conntrack_max=786432
EOF
cat >> /etc/modules-load.d/docker.conf <<EOF
options nf_conntrack hashsize=196608
EOF
```

## Networking problems

After all those changes, in my trys I was stuck at the Problem "network plugin is not ready: cni config uninitialized".
The directory `/etc/cni/net.d` on the node (which is mapped into the containers), has not been
created. I tried all network plugins rancher provided in different versions.

Well, I leave it to this for now.

