import { useEffect, useRef, useState } from 'react'
import type { PokerInjected } from './PokerPanel.tsx'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { PokerKey } from './locales.ts'
import css from './PokerPanel.module.css'

export type Sharing = {enabled:boolean; canShare:boolean; error:string; urls:string[]}
export type DiscoveredService = {name:string; url:string}
/** LAN search never signs in or switches the current service without a selection. */
export function ServiceSettings({api, t, locked}: {api:PokerInjected; t:Translate<PokerKey>; locked:boolean}) {
  const [url, setUrl] = useState(''), [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<DiscoveredService[]>([]), [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [sharing, setSharing] = useState<Sharing>({enabled:false,canShare:false,error:'',urls:[]})
  const scan = useRef<AbortController | null>(null), mounted = useRef(true)
  const search = () => {
    scan.current?.abort(); const abort = new AbortController(); scan.current = abort
    setSearching(true); setError(''); setSearched(false); setItems([])
    void api.discover(abort.signal).then(value => {
      if (!abort.signal.aborted) { setItems(value); setSearched(true) }
    }).catch(e => { if (!abort.signal.aborted) setError(String(e)) }).finally(() => {
      if (!abort.signal.aborted) setSearching(false)
    })
  }
  useEffect(() => {
    mounted.current = true
    void Promise.all([api.endpoint(), api.sharing()]).then(([value, state]) => {
      if (!mounted.current) return
      setUrl(value); setSharing(state)
      if (!value) { setExpanded(true); search() }
    }).catch(e => { if (mounted.current) setError(String(e)) })
    return () => { mounted.current = false; scan.current?.abort() }
  }, [])
  const connect = async (value:string) => {
    setSaving(true); setError('')
    try { await api.configure(value.trim()); setUrl(value.trim()); setSharing(await api.sharing()); setExpanded(false) }
    catch(e) { setError(String(e)) }
    finally { if (mounted.current) setSaving(false) }
  }
  return <section className={css.serviceSettings}>
    <button type="button" className={css.serviceSummary} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span><strong>{t('serviceTitle')}</strong><small>{url || t('chooseService')}</small></span>
      <span>{sharing.enabled ? t('sharingOn') : t('serviceSettings')} {expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div className={css.serviceBody}>
      {locked ? <p>{t('serviceLocked')}</p> : <>
        <button type="button" className={css.primary} disabled={searching || saving} onClick={search}>{t(searching ? 'searchingLan' : 'searchLan')}</button>
        <div aria-live="polite">
          {searched && items.length === 0 && <p>{t('noServices')}</p>}
          {items.map(item => <button key={item.url} type="button" className={css.serviceResult} disabled={saving} onClick={() => void connect(item.url)}>
            <span><strong>{item.name}</strong><small>{item.url}</small></span><span>{t('useService')}</span>
          </button>)}
        </div>
        <details className={css.manualService}><summary>{t('manualService')}</summary>
          <form className={css.serviceConfig} onSubmit={e => {e.preventDefault(); void connect(url)}}>
            <label>{t('serviceAddress')}<input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.10:8090/poker" /></label>
            <button type="submit" disabled={saving}>{t('saveService')}</button>
          </form>
        </details>
      </>}
      {sharing.canShare && <div className={css.sharingControls}>
        <button type="button" disabled={saving} aria-pressed={sharing.enabled} onClick={() => {
          setSaving(true); setError('')
          void api.setSharing(!sharing.enabled).then(setSharing).catch(e => setError(String(e))).finally(() => setSaving(false))
        }}>{t(sharing.enabled ? 'stopSharing' : 'startSharing')}</button>
        <p>{t('sharingHint')}</p>
        {sharing.enabled && sharing.urls.map(value => <code key={value}>{value}</code>)}
      </div>}
    </div>}
    {(error || sharing.error) && <p role="alert">{error || sharing.error}</p>}
  </section>
}
