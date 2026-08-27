# Overview

CloudBase is the private PaaS I run on a Mini PC. Developers get projects, services, logs, metrics, and HTTPS URLs. I stay in control of who can deploy and how much CPU, RAM, and disk they can use.

Live UI: [www.cloudbase.website](https://www.cloudbase.website)  
Live API: [api.cloudbase.website](https://api.cloudbase.website)

## Three separate systems

I treat these as three different things. Mixing them up is how the mental model breaks.

1. **Control plane** — this repository. Angular UI + Spring Boot API + Postgres. It stores users, projects, services, and tells Portainer / NPM what to do.
2. **Runtime** — Docker on the Mini PC, managed through Portainer. Nginx Proxy Manager owns public HTTPS. This is not in the Angular app.
3. **Tenant workloads** — other people’s apps. GitHub repos, Docker images, or databases. They run as their own stacks. They are not this repo.

Pushing this git repo does **not** update www by itself. See [operations.md](operations.md).

## Who uses it

| Role | What they can do |
|------|------------------|
| USER | Projects, services, deploy, logs, metrics, domains |
| ADMIN | Users, deploy gate, hosting tokens, infrastructure view, audit |

A new account cannot deploy until I enable `deploymentEnabled` on that user. Admins skip the gate.

There are no seed logins. I create the first admin myself (SQL or bootstrap env vars on first boot).
