/* DSH browser module. Shared React and UI primitives are supplied by DSH;
 * do not bundle a second copy of React or import host-side Node dependencies. */
window.__ModuleLoader__.load({
  id: 'dsh-tvendo',
  factory(require) {
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { SettingsForm, SettingsFormModel, SettingsSecretField, SettingsValueField, settingsTextField, settingsNumberField } = require('@deepseek-ai/dsh-client-ui-primitives')
    const NS = 'settings.tvendo'
    const zh = {
      title: 'Tvendo 工具市场', description: '配置 Tvendo 服务地址、平台密钥和单次费用上限。',
      server: '服务地址', serverHint: '例如 https://t.zhitoken.com。更换地址时请同时填写新服务的密钥；否则会清除插件中原有的密钥。',
      apiKey: 'API Key', apiKeyHint: '留空保持已有密钥。密钥保存在本机 profile 配置中，不回传已保存的值；也可留空使用环境变量或同地址的 CLI 配置。',
      keySet: '插件中已保存密钥。', keyUnset: '插件中未保存密钥（仍可使用环境变量或 CLI 配置）。',
      defaultMaxCostMicros: '默认单次费用上限（微元）', costHint: '1000000 微元 = 1 元；0 表示不额外限制。账户预算不等于本次任务的费用授权。',
      requestTimeoutMs: '请求超时（毫秒）', timeoutHint: '1000–300000，默认 120000；平台执行超时 60 秒，建议保留结算时间。',
      overridden: '已覆盖', reset: '恢复默认', invalidNumber: '请输入范围内的整数或有效的 http(s) 地址。',
      unavailable: 'Tvendo 插件未加载。', readOnly: '当前配置只读。', saveFailed: '保存失败或配置已更新，请检查输入并重新加载页面。',
      save: '保存', saving: '保存中…',
    }
    const en = {
      title: 'Tvendo tools', description: 'Configure the Tvendo server, platform key and per-call price ceiling.',
      server: 'Server URL', serverHint: 'For example https://t.zhitoken.com. Changing the URL clears the saved key unless you enter a replacement in the same save.',
      apiKey: 'API key', apiKeyHint: 'Leave blank to keep the current key. Stored in the local profile; saved values are never returned to the browser. Environment and same-server CLI credentials are also supported.',
      keySet: 'A key is saved in this plugin.', keyUnset: 'No plugin key is saved (environment or CLI credentials may still apply).',
      defaultMaxCostMicros: 'Default per-call ceiling (micros)', costHint: '1000000 micros = CNY 1; 0 means no extra ceiling. An account budget is not permission to spend.',
      requestTimeoutMs: 'Request timeout (ms)', timeoutHint: '1000–300000, default 120000. Allow time for settlement after the 60-second execution timeout.',
      overridden: 'Overridden', reset: 'Reset to default', invalidNumber: 'Enter an integer within range or a valid http(s) URL.',
      unavailable: 'The Tvendo plugin is not loaded.', readOnly: 'Settings are read-only.', saveFailed: 'Save failed or settings changed. Check the input and reload the page.',
      save: 'Save', saving: 'Saving…',
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
      constructor(scope) {
        this.scope = scope
        this.form = new SettingsFormModel(scope, [
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
          keyConfigured: scope.getSnapshot().secrets?.some(secret => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set) === true,
        }))
      }
      inject() { return { hooks: { tvendoCard: this.store }, ...this.form.actions() } }
      dispose() { this.form.dispose() }
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
          jsx(SettingsSecretField, {
            id: 'tvendo-api-key', label: t('apiKey'), hint: t('apiKeyHint'), disabled,
            text: state.apiKey.text, configured: state.keyConfigured,
            stateLabel: t(state.keyConfigured ? 'keySet' : 'keyUnset'),
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
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tvendo: settings translations')
      const t = ctx.locale.bind(NS)
      const card = new TvendoCardController(ctx.configForms.get('tvendo'))
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
    return { inject: ['slots', 'locale', 'configForms'], apply, TvendoCardController, TvendoCard }
  },
})
