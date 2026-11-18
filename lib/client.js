/* DSH browser module. Shared React and UI primitives are supplied by DSH;
 * do not bundle a second copy of React or import host-side Node dependencies. */
window.__ModuleLoader__.load({
  id: 'dsh-tvendo',
  factory(require) {
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { useState, useRef, useEffect } = require('react')
    const { SettingsForm, SettingsFormModel, SettingsValueField, settingsTextField, settingsNumberField } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'settings.tvendo'
    const zh = {
      title: 'Tvendo 工具市场', description: '配置 Tvendo 服务地址、平台密钥和单次费用上限。',
      server: '服务地址', serverHint: '例如 https://t.zhitoken.com。更换地址时请同时填写新服务的密钥；否则会清除插件中原有的密钥。',
      apiKey: 'API Key', apiKeyHint: '输入或粘贴新密钥时显示明文，请注意周围环境及屏幕共享。保存成功后显示“已保存密钥”；留空保持已有密钥。密钥保存在本机 profile 配置中，不回传原值；也可使用环境变量或同地址的 CLI 配置。',
      keySet: '插件中已保存密钥。', keyUnset: '插件中未保存密钥（仍可使用环境变量或 CLI 配置）。',
      defaultMaxCostMicros: '默认单次费用上限（微元）', costHint: '1000000 微元 = 1 元；0 表示不额外限制。账户预算不等于本次任务的费用授权。',
      requestTimeoutMs: '请求超时（毫秒）', timeoutHint: '1000–300000，默认 120000；平台执行超时 60 秒，建议保留结算时间。',
      overridden: '已覆盖', reset: '恢复默认', invalidNumber: '请输入范围内的整数或有效的 http(s) 地址。',
      unavailable: 'Tvendo 插件未加载。', readOnly: '当前配置只读。', saveFailed: '保存失败或配置已更新，请检查输入并重新加载页面。',
      save: '保存', saving: '保存中…', savedKey: '已保存密钥',
      updates: '版本更新', checkUpdate: '检查版本更新', checking: '检查中…',
      currentVersion: '当前安装版本', latestVersion: '仓库最新版本',
      updateHint: '点击后读取 GitHub main 分支的版本号，不发送 Tvendo 密钥，不自动安装更新。',
      updateAvailable: '发现新版本。请从仓库更新插件，并在升级后重启 DSH。',
      upToDate: '当前已是仓库最新版本。', ahead: '当前安装版本高于仓库版本。',
      updateFailed: '检查失败，请检查 GitHub 网络连接后重试。', openRepo: '打开 GitHub 仓库',
    }
    const en = {
      title: 'Tvendo tools', description: 'Configure the Tvendo server, platform key and per-call price ceiling.',
      server: 'Server URL', serverHint: 'For example https://t.zhitoken.com. Changing the URL clears the saved key unless you enter a replacement in the same save.',
      apiKey: 'API key', apiKeyHint: 'New keys are visible while typing or pasting. Be mindful of screen sharing. After saving, only a “Key saved” indicator is shown. Leave blank to keep the key. Stored in the local profile; saved values are never returned to the browser. Environment and same-server CLI credentials are also supported.',
      keySet: 'A key is saved in this plugin.', keyUnset: 'No plugin key is saved (environment or CLI credentials may still apply).',
      defaultMaxCostMicros: 'Default per-call ceiling (micros)', costHint: '1000000 micros = CNY 1; 0 means no extra ceiling. An account budget is not permission to spend.',
      requestTimeoutMs: 'Request timeout (ms)', timeoutHint: '1000–300000, default 120000. Allow time for settlement after the 60-second execution timeout.',
      overridden: 'Overridden', reset: 'Reset to default', invalidNumber: 'Enter an integer within range or a valid http(s) URL.',
      unavailable: 'The Tvendo plugin is not loaded.', readOnly: 'Settings are read-only.', saveFailed: 'Save failed or settings changed. Check the input and reload the page.',
      save: 'Save', saving: 'Saving…', savedKey: 'Key saved',
      updates: 'Version updates', checkUpdate: 'Check for updates', checking: 'Checking…',
      currentVersion: 'Installed version', latestVersion: 'Latest repository version',
      updateHint: 'Reads the version on GitHub’s main branch on demand. No Tvendo key is sent and no update is installed automatically.',
      updateAvailable: 'A newer version is available. Update the plugin from the repository and restart DSH.',
      upToDate: 'You have the latest repository version.', ahead: 'The installed version is newer than the repository version.',
      updateFailed: 'Could not check for updates. Check your GitHub connection and try again.', openRepo: 'Open GitHub repository',
    }
    function normalize(value) {
      try {
        const url = new URL(value)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
        return url.origin + url.pathname.replace(/\/+$/, '')
      } catch { return undefined }
    }
    function integer(field, min, max) {
      return { ...settingsNumberField(field), parse(text) {
        const value = Number(text)
        return text.trim() && Number.isSafeInteger(value) && value >= min && value <= max
          ? { kind: 'set', value } : undefined
      } }
    }
    class TvendoCardController {
      constructor(scope, mirror) {
        this.scope = scope
        // ConfigForm snapshots intentionally omit `secrets`. Presence markers
        // live on the shared describe mirror, separate from redacted values.
        // Observe both so saving a secret or reopening the page updates the UI.
        const formScope = {
          getSnapshot: () => scope.getSnapshot(),
          mutate: (...args) => scope.mutate(...args),
          subscribe(listener) {
            const offForm = scope.subscribe(listener)
            const offMirror = mirror.subscribe(listener)
            return () => { offForm(); offMirror() }
          },
        }
        this.form = new SettingsFormModel(formScope, [
          { ...settingsTextField('server'), parse(text) {
            const value = normalize(text.trim())
            return value ? { kind: 'set', value } : undefined
          } },
          // Never project the redacted backend value into the password input.
          // Empty input compares equal to format() and generates no mutation.
          { field: 'apiKey', format: () => '', parse: text => ({ kind: 'set', value: text.trim() }) },
          integer('defaultMaxCostMicros', 0, Number.MAX_SAFE_INTEGER),
          integer('requestTimeoutMs', 1000, 300000),
        ])
        const originalPlan = this.form.plan.bind(this.form)
        this.form.plan = () => {
          const plan = originalPlan()
          const server = plan.find(item => item.field === 'server')?.op?.value
          if (server && server !== normalize(scope.getSnapshot().value?.server) && !plan.some(item => item.field === 'apiKey')) {
            plan.push({ field: 'apiKey', op: { op: 'set', path: ['apiKey'], value: '' } })
          }
          return plan
        }
        this.store = this.form.bind(() => ({
          ...this.form.shell(),
          server: this.form.field('server'), apiKey: this.form.field('apiKey'),
          defaultMaxCostMicros: this.form.field('defaultMaxCostMicros'),
          requestTimeoutMs: this.form.field('requestTimeoutMs'),
          keyConfigured: mirror.getSnapshot().view?.namespaces
            .find(namespace => namespace.ns === 'tvendo')?.secrets
            ?.some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set) === true,
        }))
      }
      inject() { return { hooks: { tvendoCard: this.store }, ...this.form.actions() } }
      dispose() { this.form.dispose() }
    }
    // The saved indicator is an overlay, never an input value. Only a newly
    // entered draft is visible; persisted credentials are never read back.
    function TvendoSecretField(props) {
      const { id, label, hint, text, configured, stateLabel, savedLabel, disabled, onEdit } = props
      return jsxs('div', {
        style: { display: 'grid', gap: 8 },
        children: [
          jsxs('div', {
            style: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' },
            children: [jsx('label', { htmlFor: id, children: label }), jsx('span', { style: { fontSize: 12, opacity: 0.7 }, children: stateLabel })],
          }),
          jsxs('div', {
            style: { position: 'relative' },
            children: [
              jsx('input', {
                id, type: 'text', autoComplete: 'off', spellCheck: false,
                autoCapitalize: 'none', value: text, placeholder: '',
                disabled, 'aria-describedby': `${id}-hint${configured && !text ? ` ${id}-saved` : ''}`,
                style: { width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-main, #8886)', background: 'transparent', color: 'inherit', font: 'inherit' },
                onChange: event => onEdit(event.target.value),
              }),
              configured && !text ? jsx('span', {
                id: `${id}-saved`,
                style: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#888', fontWeight: 700, fontStyle: 'italic' },
                children: savedLabel,
              }) : null,
            ],
          }),
          jsx('p', { id: `${id}-hint`, style: { margin: 0, fontSize: 12, opacity: 0.7 }, children: hint }),
        ],
      })
    }
    function TvendoCard(props) {
      const { t } = props
      const state = props.useTvendoCard(snapshot => snapshot)
      if (props.view === 'summary') return t('description')
      const disabled = !state.writable || state.saving
      const fields = [['server', 'serverHint'], ['defaultMaxCostMicros', 'costHint'], ['requestTimeoutMs', 'timeoutHint']]
      return jsxs(SettingsForm, {
        labels: Object.fromEntries(['unavailable', 'readOnly', 'saveFailed', 'save', 'saving'].map(key => [key, t(key)])),
        state, onSave: props.save, onDiscard: props.discard,
        children: [
          jsx(TvendoSecretField, {
            id: 'tvendo-api-key', label: t('apiKey'), hint: t('apiKeyHint'), disabled,
            text: state.apiKey.text, configured: state.keyConfigured,
            stateLabel: t(state.keyConfigured ? 'keySet' : 'keyUnset'), savedLabel: t('savedKey'),
            onEdit: text => props.edit('apiKey', text),
          }),
          ...fields.map(([field, hint]) => jsx(SettingsValueField, {
            id: `tvendo-${field}`, label: t(field), hint: t(hint), disabled,
            numeric: field !== 'server', ...state[field],
            overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalidNumber'),
            onEdit: text => props.edit(field, text), onReset: () => props.resetField(field),
          }, field)),
        ],
      })
    }
    const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/Broken-Rabbit/tvendo_dsh/main/package.json'
    const REPOSITORY_URL = 'https://github.com/Broken-Rabbit/tvendo_dsh'
    function parseVersion(value) {
      if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid version')
      const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
      if (!match) throw new Error('Invalid version')
      const parts = match.slice(1, 4).map(Number)
      const prerelease = match[4]?.split('.') ?? []
      if (parts.some(part => !Number.isSafeInteger(part)) || prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) throw new Error('Invalid version')
      return { parts, prerelease }
    }
    // SemVer precedence, including numeric prerelease identifiers and ignoring
    // build metadata. A positive value means left is newer than right.
    function compareVersions(left, right) {
      const a = parseVersion(left), b = parseVersion(right)
      for (let index = 0; index < 3; index++) {
        if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1
      }
      if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length)
      for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
        const x = a.prerelease[index], y = b.prerelease[index]
        if (x === undefined || y === undefined) return x === undefined ? -1 : 1
        if (x === y) continue
        const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
        if (nx !== ny) return nx ? -1 : 1
        if (nx) return x.length !== y.length ? (x.length > y.length ? 1 : -1) : (x > y ? 1 : -1)
        return x > y ? 1 : -1
      }
      return 0
    }
    async function checkForUpdates(currentVersion, { fetchImpl = globalThis.fetch, signal } = {}) {
      parseVersion(currentVersion)
      const timeout = AbortSignal.timeout(15000)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      const response = await fetchImpl(UPDATE_MANIFEST_URL, {
        method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { accept: 'application/json' }, signal: combined,
      })
      if (!response.ok) throw new Error('Update request failed')
      if (Number(response.headers.get('content-length')) > 65536) throw new Error('Manifest too large')
      const text = await response.text()
      if (text.length > 65536) throw new Error('Manifest too large')
      const manifest = JSON.parse(text)
      if (manifest?.name !== 'dsh-tvendo') throw new Error('Unexpected package')
      const comparison = compareVersions(manifest.version, currentVersion)
      return { currentVersion, latestVersion: manifest.version, comparison }
    }
    function TvendoUpdatePanel({ t, currentVersion }) {
      const [state, setState] = useState({ status: 'idle' })
      const active = useRef(null)
      useEffect(() => () => { active.current?.abort() }, [])
      async function check() {
        if (active.current) return
        const controller = new AbortController()
        active.current = controller
        setState({ status: 'loading' })
        try {
          const result = await checkForUpdates(currentVersion, { signal: controller.signal })
          if (!controller.signal.aborted) setState({ status: 'ready', ...result })
        } catch {
          if (!controller.signal.aborted) setState({ status: 'error' })
        } finally {
          if (active.current === controller) active.current = null
        }
      }
      return jsxs('section', {
        'data-tvendo-updates': true, style: { display: 'grid', gap: 12 },
        children: [
          jsx('h3', { style: { margin: 0 }, children: t('updates') }),
          jsx('div', { children: `${t('currentVersion')}: ${currentVersion ?? '—'}` }),
          jsx('p', { style: { margin: 0, opacity: 0.7, fontSize: 12 }, children: t('updateHint') }),
          jsx('button', {
            type: 'button', disabled: state.status === 'loading' || !currentVersion,
            onClick: check,
            style: { justifySelf: 'start', cursor: state.status === 'loading' ? 'wait' : 'pointer', padding: '7px 12px', borderRadius: 8, border: '1px solid #8886', background: 'transparent', color: 'inherit', font: 'inherit' },
            children: t(state.status === 'loading' ? 'checking' : 'checkUpdate'),
          }),
          jsx('div', {
            role: 'status', 'aria-live': 'polite',
            children: state.status === 'error' ? t('updateFailed') : state.status === 'ready' ? jsxs('div', {
              children: [
                jsx('div', { children: `${t('latestVersion')}: ${state.latestVersion}` }),
                jsx('p', { children: t(state.comparison > 0 ? 'updateAvailable' : state.comparison < 0 ? 'ahead' : 'upToDate') }),
              ],
            }) : null,
          }),
          jsx('a', { href: REPOSITORY_URL, target: '_blank', rel: 'noopener noreferrer', children: t('openRepo') }),
        ],
      })
    }
    function TvendoUpdateSection({ subject, t }) {
      if (subject?.kind !== 'bundle' || subject.pkg?.name !== 'dsh-tvendo' || !subject.pkg.installed) return null
      return jsx(TvendoUpdatePanel, { t, currentVersion: subject.pkg.version })
    }
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tvendo: settings translations')
      const t = ctx.locale.bind(NS)
      // Extension point rendered by Plugins → Installed → Tvendo tools.
      // It is independent of the configuration form's availability.
      ctx.effect(() => ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
        name: 'plugins.detail.section', id: 'tvendo-updates', order: 60, locale: NS,
      }, TvendoUpdateSection)), 'tvendo: installed plugin updates')
      const card = new TvendoCardController(ctx.configForms.get('tvendo'), ctx.configForms.describe())
      ctx.effect(() => () => card.dispose(), 'tvendo: settings subscription')
      ctx.effect(() => ctx.configForms.whileServed(['tvendo'], () => {
        // A direct Settings navigation item avoids hiding this third-party
        // configuration behind the misleading "Built-in plugins" section.
        const section = ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'tvendo', order: 65, label: () => t('title'), locale: NS,
          inject: () => card.inject(),
        }, TvendoCard))
        const item = ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'tvendo', order: 60, label: () => t('title'), locale: NS,
          inject: () => card.inject(),
        }, TvendoCard))
        return () => { item(); section() }
      }), 'tvendo: settings page')
    }
    return { inject: ['slots', 'locale', 'configForms'], apply, TvendoCardController, TvendoCard, TvendoSecretField, TvendoUpdateSection, TvendoUpdatePanel, checkForUpdates, compareVersions }
  },
})
