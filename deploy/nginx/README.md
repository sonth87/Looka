# Swagger behind nginx

`nginx.conf` publishes the API's Swagger UI on port **8088**, proxying to the
API on `127.0.0.1:3100`. There is no password: limit who can reach the port with
the firewall (see below). The API under `/v1/` is protected by its own guards.

| URL | What |
| --- | --- |
| `http://<host>:8088/docs` | Swagger UI |
| `http://<host>:8088/docs-json` | OpenAPI document (JSON) |
| `http://<host>:8088/docs-yaml` | OpenAPI document (YAML) |
| `http://<host>:8088/v1/...` | the real API (what "Try it out" calls) |

Every other path on that port returns 404.

## Windows (as set up on the dev machine)

nginx 1.30.5 (stable) lives in `D:\tools\nginx`.

```powershell
# install the config from this folder
Copy-Item Looka\deploy\nginx\nginx.conf D:\tools\nginx\conf\nginx.conf -Force
D:\tools\nginx\nginx.exe -p D:\tools\nginx -t      # validate

# start / reload / stop
Start-Process D:\tools\nginx\nginx.exe -ArgumentList '-p','D:\tools\nginx' -WorkingDirectory D:\tools\nginx -WindowStyle Hidden
D:\tools\nginx\nginx.exe -p D:\tools\nginx -s reload
D:\tools\nginx\nginx.exe -p D:\tools\nginx -s stop
```

Windows Defender Firewall blocks inbound connections from other machines until
you allow the port. From an elevated `cmd` (only the local subnet, on the
network profile your Wi-Fi actually uses — Public networks need `profile=any`):

```bat
netsh advfirewall firewall add rule name="Looka Swagger (nginx 8088)" dir=in action=allow protocol=TCP localport=8088 profile=any remoteip=localsubnet
netsh advfirewall firewall delete rule name="Looka Swagger (nginx 8088)"
```

Then other machines on the subnet open `http://<this-machine-LAN-IP>:8088/docs`.

## Linux server

Copy `nginx.conf` to `/etc/nginx/nginx.conf` (or lift the `server { ... }`
block into `/etc/nginx/conf.d/looka-docs.conf`), then
`nginx -t && systemctl reload nginx`. To publish on a domain, set `server_name`
and add a `listen 443 ssl` block with your certificate. Without a password on a
reachable port, restrict access with `allow <cidr>; deny all;` in `server`.

## "Try it out"

Swagger UI's "Try it out" sends requests to `/v1/...` on the page's own origin,
so `nginx.conf` proxies `/v1/` to the API (with `client_max_body_size 30m` to
match the API's 25mb JSON limit). Use the **Authorize** button as usual: the
`sso` Bearer token or `x-api-key` you enter is forwarded to the API untouched.
To publish docs only, delete the `location /v1/` block and reload.

## Blank page over http from a LAN IP

The API's `helmet()` sends `Content-Security-Policy: ...; upgrade-insecure-requests`.
Browsers exempt `localhost`, but from `http://<lan-ip>:8088` they turn Swagger's
CSS/JS requests into `https://` ones this port can't answer, so `/docs` renders
blank (nginx's access log fills with `\x16\x03\x01...` 400s). The `/docs`
location therefore replaces that header with the same policy minus the one
directive. If you ever proxy `/docs` in some other setup and see a blank page,
that is the first thing to check.
