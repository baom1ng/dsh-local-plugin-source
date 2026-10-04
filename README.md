# dsh-local-plugin-source

English | [中文](README.zh.md)

Turn a local folder (default `%USERPROFILE%\.dsh\local-plugins`) into **an in-app plugin source**: it lists the plugin packages in
that folder inside **Settings → Plugins → Local plugins** and lets you **install / reinstall / enable / disable / remove** them.

It exists so locally developed plugins can be installed back at any time without copying absolute paths around or asking the Agent.

**Requirements:** the DeepSeek Harness Desktop app, or any Harness profile with a web UI. The bundle row carries **no `disabled` gate** — it activates
in every profile, and the page simply stays quiet where no webserver runs.

---

## 1. What it solves

A local plugin such as [`dsh-desktop-archive-manager`](https://www.npmjs.com/package/dsh-desktop-archive-manager) used to be installable
only by pasting its absolute path into **Plugins → Add plugin**. This plugin turns that folder into a list on a page:

- after removing a local plugin you can install it back from **Settings → Plugins → Local plugins** with one click;
- any DSH bundle dropped into the folder shows up automatically (host-only or with a browser half);
- an ordinary package without a bundle patch is labelled "no bundle patch" and offers no install button (installing it would activate nothing).

## 2. Install

It is a bundle itself, so it installs like any other local plugin — through the profile's own Plugin Manager:

```text
# Agent side
plugin_manager: install_bundle(target: "C:\\Users\\<you>\\.dsh\\local-plugins\\dsh-local-plugin-source")

# Or the app: sidebar Plugins → Add plugin, paste the same absolute path
```

Afterwards **Settings → Plugins** has an extra **Local plugins** tab.

## 3. What each action does

Every action is forwarded to the **profile's own Plugin Manager** (`ctx.pluginManager`), so manifest writes, bundle selection,
pnpm calls and Loader recomposition behave exactly like the official install path — this plugin contributes a *source*, not a second installer.

| Action | Host call | Notes |
|---|---|---|
| Install / Reinstall | `pluginManager.installBundle(<absolute path>, { enabled: true })` | installs and enables; on an installed bundle it is a reinstall (use it after editing local source) |
| Enable / Disable | `pluginManager.setBundleEnabled(name, enabled)` | toggles the bundle layer only, keeping dependencies and files |
| Remove | `pluginManager.removeBundle(name)` | runs `pnpm remove`; a bundle the manager protects reports its own error |

Card state comes from `pluginManager.listBundles()` — **installed / enabled / disabled / not installed**, plus the manager's
`readOnlyReason` and the activation error when a bundle fails to load. The pnpm output of an install is shown at the bottom of the page
(last 4 KB; the full log stays in the profile's `.plugin-manager/logs`).

Safety boundaries:

- **only scanned packages can be installed**: the endpoint looks a row up by package name inside the scanned list and never accepts a
  caller-supplied path, so there is no path traversal;
- one exact route `/local-plugin-source/api` with a same-origin check (Origin header + a custom request header);
- request bodies are capped at 64 KB.

## 4. Configuration

| Key | Default | Meaning |
|---|---|---|
| `directory` | `%DSH_HOME%\local-plugins` | the folder that gets scanned |

Change it from a profile patch layer:

```yaml
- id: local-plugin-source
  config:
    directory: D:\\my-dsh-plugins
```

## 5. Package layout

```text
dsh-local-plugin-source/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # bundle patch: the local-plugin-source row (patch-relative to lib/manager.js)
├── lib/manager.js        # host half: /local-plugin-source/api → ctx.pluginManager
├── lib/scan.js           # dependency-free scanning/classification (unit-tested)
├── lib/client.js         # browser half: the Settings → Plugins → Local plugins tab
├── test/*.test.mjs       # node --test suite (25 tests)
├── LICENSE
└── README.md / README.zh.md
```

## 6. Tests

```powershell
node --test "test/*.test.mjs"
```

25 tests cover manifest reading and classification (bundle / browser half / not a package / broken JSON / hidden directories),
merging installed state, a missing directory, the endpoint gates (method / cross-origin / bad JSON / unknown op),
"only scanned packages are installable", structured reporting of manager failures, both `listBundles()` return shapes,
and the browser half (tab registration, the inject-face flattening contract, the button set of each of the four states,
empty state, failure notice, and that the English dictionary covers every key the page uses).

## 7. Known limitations

- **It only manages packages in that folder**: it does not scan arbitrary paths and does not take over npm/git installs — those remain
  the job of the official **Add plugin** dialog and the `plugin_manager` tool.
- **The profile must be writable**: the desktop profile is app-managed; this plugin goes through the same service, so it never bypasses
  the manager's locks or compatibility checks.
- **Reinstall to update code**: after editing a local plugin, reinstall it to get the new version into the profile; a module already in
  memory still follows DSH's module-cache rules, so a restart may be needed.
