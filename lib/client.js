/**
 * Local plugin source — browser half (prebuilt module-loader bundle).
 *
 * Adds one page to the app's Plugins settings section: every package found in
 * the local plugin folder, with install / enable / disable / remove actions.
 * Each action goes to this package's host half, which drives the profile's own
 * Plugin Manager — so the app remains the only installer.
 */
window.__ModuleLoader__.load({
	id: "dsh-local-plugin-source",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const jsxRuntime = require("react/jsx-runtime");
		const jsx = jsxRuntime.jsx;
		const jsxs = jsxRuntime.jsxs;
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const store = require("@deepseek-ai/dsh-client-store");

		//#region styles
		const CSS = [
			".lps_root{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px}",
			".lps_head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}",
			".lps_headMain{flex:1 1 260px;min-width:0}",
			".lps_title{font-size:14px;line-height:20px;font-weight:600}",
			".lps_subtitle{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
			".lps_path{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);word-break:break-all}",
			".lps_actions{display:flex;gap:8px;flex:0 0 auto}",
			".lps_error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);word-break:break-word}",
			".lps_list{display:flex;flex-direction:column;gap:8px}",
			".lps_card{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}",
			".lps_cardMain{flex:1 1 auto;min-width:0}",
			".lps_name{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px}",
			".lps_pkgName{font-weight:600;word-break:break-all}",
			".lps_version{color:var(--dsw-alias-label-secondary);font-size:12px}",
			".lps_desc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
			".lps_badges{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
			".lps_badge{font-size:11px;line-height:16px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}",
			".lps_badgeOn{color:var(--dsw-alias-state-success-primary)}",
			".lps_badgeWarn{color:var(--dsw-alias-state-warn-primary)}",
			".lps_badgeError{color:var(--dsw-alias-state-error-primary)}",
			".lps_cardActions{display:flex;gap:6px;flex:0 0 auto;align-items:center}",
			".lps_empty{display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;min-height:140px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center}",
			".lps_hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
			".lps_output{margin-top:8px;max-height:160px;overflow:auto;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all}",
		].join("");
		const CSS_TAG = "dsh-local-plugin-source/local-plugin-source.css";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_TAG)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-local-plugin-source";
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region locales
		const NS = "local-plugin-source";
		const en = {
			tab: "Local plugins",
			title: "Plugins in the local folder",
			subtitle: "Install, update or remove a bundle kept in the local plugin folder. Every action goes through this profile's own Plugin Manager.",
			refresh: "Refresh",
			empty: "No local plugins found",
			emptyHint: "Put a DSH package (a folder with its own package.json) into the folder above, then refresh.",
			installed: "Installed",
			enabled: "Enabled",
			disabled: "Disabled",
			notInstalled: "Not installed",
			bundle: "Bundle",
			plain: "No bundle patch",
			client: "Has browser half",
			problem: "Manager reports: {reason}",
			activationError: "Activation error: {error}",
			install: "Install",
			reinstall: "Reinstall",
			enable: "Enable",
			disable: "Disable",
			remove: "Remove",
			busy: "Working…",
			loadFailed: "Could not read the local plugin folder",
			actionFailed: "The action failed",
			installedNotice: "Installed {name}",
			removedNotice: "Removed {name}",
			enabledNotice: "{name} is now enabled",
			disabledNotice: "{name} is now disabled",
			details: "Details",
		};
		const zh = {
			tab: "本地插件",
			title: "本地插件目录中的插件",
			subtitle: "安装、更新或卸载本地插件目录里的 bundle。所有操作都交给当前配置档自己的插件管理器执行。",
			refresh: "刷新",
			empty: "没有找到本地插件",
			emptyHint: "把带 package.json 的 DSH 插件包放进上面的目录，然后刷新。",
			installed: "已安装",
			enabled: "已启用",
			disabled: "已停用",
			notInstalled: "未安装",
			bundle: "含 bundle 补丁",
			plain: "无 bundle 补丁",
			client: "含浏览器端",
			problem: "管理器报告：{reason}",
			activationError: "激活失败：{error}",
			install: "安装",
			reinstall: "重新安装",
			enable: "启用",
			disable: "停用",
			remove: "卸载",
			busy: "处理中…",
			loadFailed: "无法读取本地插件目录",
			actionFailed: "操作失败",
			installedNotice: "已安装 {name}",
			removedNotice: "已卸载 {name}",
			enabledNotice: "{name} 已启用",
			disabledNotice: "{name} 已停用",
			details: "详情",
		};
		//#endregion

		//#region host channel
		const ENDPOINT = "/local-plugin-source/api";
		async function callHost(op, payload) {
			let response;
			try {
				response = await fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json", "x-dsh-local-plugin-source": "1" },
					body: JSON.stringify(payload === undefined ? { op } : { op, ...payload }),
				});
			}
			catch (error) {
				const failure = new Error(messageOf(error));
				failure.code = "local-plugin-source/unreachable";
				throw failure;
			}
			if (!response.ok) {
				const failure = new Error(`HTTP ${response.status}`);
				failure.code = "local-plugin-source/unreachable";
				throw failure;
			}
			const envelope = await response.json();
			if (envelope === null || typeof envelope !== "object" || envelope.ok !== true) {
				const details = envelope && envelope.error ? envelope.error : {};
				const failure = new Error(details.message || "local plugin source request failed");
				failure.code = details.code;
				failure.details = details.details;
				throw failure;
			}
			return envelope.value;
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion

		//#region model
		class SourceModel {
			constructor() {
				this.requestId = 0;
				this.sequence = 0;
				this.store = store.createSnapshotStore({
					status: "idle",
					directory: undefined,
					items: [],
					error: null,
					busy: null,
					output: null,
					notice: null,
				});
				this.subscribe = this.store.subscribe;
				this.getSnapshot = this.store.getSnapshot;
			}
			update(mutate) {
				this.store.update(mutate);
			}
			async load() {
				const requestId = ++this.requestId;
				this.update((state) => {
					state.status = state.items.length === 0 ? "loading" : "refreshing";
					state.error = null;
				});
				try {
					const value = await callHost("list");
					if (requestId !== this.requestId) return;
					this.update((state) => {
						state.directory = value.directory;
						state.items = Array.isArray(value.items) ? value.items : [];
						state.status = "ready";
						state.error = null;
					});
				}
				catch (error) {
					if (requestId !== this.requestId) return;
					this.update((state) => {
						state.status = "error";
						state.error = messageOf(error);
					});
				}
			}
			async act(op, payload, noticeKey) {
				this.update((state) => {
					state.busy = payload.name;
					state.output = null;
				});
				let result;
				try {
					result = await callHost(op, payload);
				}
				catch (error) {
					this.update((state) => {
						state.busy = null;
						state.notice = { tone: "error", text: "actionFailed", params: { detail: messageOf(error) }, seq: ++this.sequence };
					});
					return;
				}
				await this.load();
				this.update((state) => {
					state.busy = null;
					state.notice = noticeKey === null
						? null
						: { tone: "success", text: noticeKey, params: { name: payload.name }, seq: ++this.sequence };
					state.output = typeof result?.output === "string" && result.output.trim() !== "" ? result.output.trim() : null;
				});
			}
			install(name) {
				return this.act("install", { name }, "installedNotice");
			}
			remove(name) {
				return this.act("remove", { name }, "removedNotice");
			}
			setEnabled(name, enabled) {
				return this.act("setEnabled", { name, enabled }, enabled ? "enabledNotice" : "disabledNotice");
			}
			dismissNotice() {
				this.update((state) => {
					state.notice = null;
				});
			}
		}
		//#endregion

		//#region components
		/** One local package: state badges plus the actions valid in that state. */
		function LocalPluginRow(props) {
			const { t, item, busy, onInstall, onRemove, onEnable, onDisable } = props;
			const working = busy === item.name;
			const badges = [];
			badges.push(jsx("span", {
				className: item.installed ? "lps_badge lps_badgeOn" : "lps_badge",
				children: item.installed ? t("installed") : t("notInstalled"),
			}, "install"));
			if (item.installed) {
				badges.push(jsx("span", {
					className: item.enabled ? "lps_badge lps_badgeOn" : "lps_badge",
					children: item.enabled ? t("enabled") : t("disabled"),
				}, "enabled"));
			}
			badges.push(jsx("span", { className: "lps_badge", children: item.bundle ? t("bundle") : t("plain") }, "bundle"));
			if (item.client) badges.push(jsx("span", { className: "lps_badge", children: t("client") }, "client"));
			if (typeof item.managementProblem === "string") {
				badges.push(jsx("span", {
					className: "lps_badge lps_badgeWarn",
					children: t("problem", { reason: item.managementProblem }),
				}, "problem"));
			}
			if (typeof item.activationError === "string") {
				badges.push(jsx("span", {
					className: "lps_badge lps_badgeError",
					children: t("activationError", { error: item.activationError }),
				}, "error"));
			}
			const actions = [];
			if (item.bundle !== true) {
				actions.push(jsx("span", { className: "lps_hint", children: t("plain") }, "blocked"));
			}
			else {
				actions.push(jsx(primitives.Button, {
					variant: item.installed ? "outline" : "primary",
					disabled: working,
					onClick: () => { onInstall(item); },
					children: item.installed ? t("reinstall") : t("install"),
				}, "install"));
				if (item.installed && item.enabled === true) {
					actions.push(jsx(primitives.Button, {
						variant: "ghost",
						disabled: working,
						onClick: () => { onDisable(item); },
						children: t("disable"),
					}, "disable"));
				}
				if (item.installed && item.enabled !== true) {
					actions.push(jsx(primitives.Button, {
						variant: "outline",
						disabled: working,
						onClick: () => { onEnable(item); },
						children: t("enable"),
					}, "enable"));
				}
				if (item.installed && item.removable === true) {
					actions.push(jsx(primitives.Button, {
						variant: "ghost",
						icon: jsx(primitives.IconTrashOutlineRegular, { size: 16 }),
						disabled: working,
						onClick: () => { onRemove(item); },
						children: t("remove"),
					}, "remove"));
				}
			}
			return jsxs("div", {
				className: "lps_card",
				children: [
					jsxs("div", {
						className: "lps_cardMain",
						children: [
							jsxs("div", {
								className: "lps_name",
								children: [
									jsx("span", { className: "lps_pkgName", children: item.name }),
									item.version === undefined ? null : jsx("span", { className: "lps_version", children: item.version }),
								],
							}),
							item.description === undefined ? null : jsx("div", { className: "lps_desc", children: item.description }),
							jsx("div", { className: "lps_badges", children: badges }),
							item.directory === undefined ? null : jsx("div", { className: "lps_path", children: item.directory }),
						],
					}),
					jsx("div", { className: "lps_cardActions", children: working ? jsx("span", { className: "lps_hint", children: t("busy") }) : actions }),
				],
			}, item.name);
		}

		/** The settings page listing the local source. */
		function LocalPluginSourcePage(props) {
			const { t, useSource, load, install, remove, setEnabled } = props;
			const state = useSource((value) => value);
			const items = state.items;

			return jsxs("div", {
				className: "lps_root",
				children: [
					jsxs("div", {
						className: "lps_head",
						children: [
							jsxs("div", {
								className: "lps_headMain",
								children: [
									jsx("div", { className: "lps_title", children: t("title") }),
									jsx("div", { className: "lps_subtitle", children: t("subtitle") }),
									state.directory === undefined ? null : jsx("div", { className: "lps_path", children: state.directory }),
								],
							}),
							jsx("div", {
								className: "lps_actions",
								children: jsx(primitives.Button, {
									variant: "ghost",
									icon: jsx(primitives.IconRefreshOutlineRegular, { size: 16 }),
									disabled: state.busy !== null,
									onClick: () => { load(); },
									children: t("refresh"),
								}),
							}),
						],
					}),
					state.error === null ? null : jsx("div", { className: "lps_error", children: `${t("loadFailed")}: ${state.error}` }),
					state.notice === null ? null : jsx("div", {
						className: state.notice.tone === "error" ? "lps_error" : "lps_hint",
						children: state.notice.tone === "error"
							? `${t("actionFailed")}: ${String(state.notice.params.detail ?? "")}`
							: t(state.notice.text, state.notice.params),
					}),
					items.length === 0
						? jsxs("div", {
							className: "lps_empty",
							children: [
								jsx(primitives.IconCordisPluginOutlineRegular, { size: 26 }),
								jsx("div", { children: state.status === "loading" ? t("busy") : t("empty") }),
								jsx("div", { children: t("emptyHint") }),
							],
						})
						: jsx("div", {
							className: "lps_list",
							children: items.map((item) => jsx(LocalPluginRow, {
								t,
								item,
								busy: state.busy,
								onInstall: (target) => { install(target.name); },
								onRemove: (target) => { remove(target.name); },
								onEnable: (target) => { setEnabled(target.name, true); },
								onDisable: (target) => { setEnabled(target.name, false); },
							}, item.name)),
						}),
					state.output === null ? null : jsx("div", { className: "lps_output", children: state.output }),
				],
			});
		}
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), "local-plugin-source: dictionaries");
			const t = ctx.locale.bind(NS);
			const model = new SourceModel();
			void model.load();

			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "local-source",
				order: 20,
				locale: NS,
				// `hooks` sources project as `use<Name>` selector hooks on the component.
				// The action callbacks return their promise so a caller (including a
				// test) can await the whole round trip; React ignores the value.
				inject: () => ({
					hooks: { source: model },
					load: () => model.load(),
					install: (name) => model.install(name),
					remove: (name) => model.remove(name),
					setEnabled: (name, enabled) => model.setEnabled(name, enabled),
				}),
			}, LocalPluginSourcePage));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
