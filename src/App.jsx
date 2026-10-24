import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck,
  Check, ChevronDown, CircleHelp, Clock3, FileCheck2, FileImage, FileText, Filter,
  Globe2, ImagePlus, LoaderCircle, LockKeyhole, Menu, MoreHorizontal, Plus, Search,
  ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react'

const API = '/api'
const demoClaim = 'The university has cancelled all examinations this week'
const initialSamples = [
  { label: 'Exams cancelled', claim: demoClaim, sourceIndex: 0, message: 'Forwarded message: Urgent notice. All examinations scheduled for this week have been cancelled. Please share with your class.' },
  { label: 'Exams continue', claim: demoClaim, sourceIndex: 1, message: 'A screenshot is circulating that says all examinations are cancelled this week.' },
]

function formatDate(value) {
  if (!value) return 'Just now'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}
function titleCase(s = '') { return s.charAt(0).toUpperCase() + s.slice(1) }
function assessmentClass(a = 'Inconclusive') { return a.toLowerCase() }
function shortClaim(s = '') { return s.length > 76 ? `${s.slice(0, 73)}…` : s }

function Logo() {
  return <div className="brand"><span className="brand-mark"><ShieldCheck size={19} strokeWidth={2.2} /></span><span>evidence<span className="brand-light">desk</span></span></div>
}

function AssessmentBadge({ assessment, small = false }) {
  const Icon = assessment === 'Supported' ? BadgeCheck : assessment === 'Contradicted' ? AlertCircle : CircleHelp
  return <span className={`badge badge-${assessmentClass(assessment)} ${small ? 'badge-small' : ''}`}><Icon size={small ? 13 : 15} />{assessment || 'Inconclusive'}</span>
}

function EmptyState({ onCreate }) {
  return <div className="empty-state"><div className="empty-icon"><FileCheck2 size={25} /></div><h3>No investigations yet</h3><p>Start with a claim and the evidence you have. Your investigation history will appear here.</p><button className="button button-primary" onClick={onCreate}><Plus size={16} /> Start an investigation</button></div>
}

export default function App() {
  const [items, setItems] = useState([])
  const [demoSources, setDemoSources] = useState([])
  const [selected, setSelected] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [isCreateOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All checks')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [form, setForm] = useState({ claim: '', message: '', sources: [], file: null })
  const fileInput = useRef(null)

  const refresh = async () => {
    try {
      const [investigations, fixtures] = await Promise.all([fetch(`${API}/investigations`), fetch(`${API}/demo-sources`)])
      if (!investigations.ok || !fixtures.ok) throw new Error('Could not connect to the local API. Start the backend and try again.')
      setItems(await investigations.json()); setDemoSources(await fixtures.json()); setError('')
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])

  const filteredItems = useMemo(() => items.filter(item => {
    const matchesText = item.claim.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'All checks' || item.assessment === filter
    return matchesText && matchesFilter
  }), [items, search, filter])

  const openCreate = (sample = null) => {
    setError('')
    setForm(sample ? { claim: sample.claim, message: sample.message, sources: demoSources[sample.sourceIndex] ? [demoSources[sample.sourceIndex].url] : [], file: null } : { claim: '', message: '', sources: [], file: null })
    setCreateOpen(true); setSelected(null); setSidebarOpen(false)
  }

  const submit = async (event) => {
    event.preventDefault(); setPending(true); setError('')
    const data = new FormData(); data.set('claim', form.claim); data.set('message', form.message); data.set('source_urls', JSON.stringify(form.sources))
    if (form.file) data.set('file', form.file)
    try {
      const response = await fetch(`${API}/investigations`, { method: 'POST', body: data })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Investigation could not be created.')
      await refresh(); setSelected(result); setCreateOpen(false); setActiveTab('overview')
    } catch (e) { setError(e.message) } finally { setPending(false) }
  }

  const openReport = async item => {
    try {
      const response = await fetch(`${API}/investigations/${item.id}`)
      if (!response.ok) throw new Error('Could not open this report.')
      setSelected(await response.json()); setCreateOpen(false); setActiveTab('overview'); setSidebarOpen(false)
    } catch (e) { setError(e.message) }
  }

  const dashboard = !selected && !isCreateOpen
  return <div className="app-shell">
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
      <Logo />
      <div className="topbar-center"><span className="workspace-dot" /> Personal workspace <ChevronDown size={14} /></div>
      <div className="topbar-right"><span className="privacy-note"><LockKeyhole size={13} /> Private workspace</span><button className="avatar" title="Account">S</button></div>
    </header>

    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <button className="button button-primary sidebar-new" onClick={() => openCreate()}><Plus size={17} /> New investigation</button>
        <div className="nav-label">Workspace</div>
        <button className={`nav-item ${dashboard ? 'nav-active' : ''}`} onClick={() => { setSelected(null); setCreateOpen(false); setSidebarOpen(false) }}><Activity size={17} /> Overview <span className="nav-count">{items.length}</span></button>
        <div className="nav-label nav-label-spaced">Your history <button className="mini-icon" title="History"><MoreHorizontal size={16} /></button></div>
        <div className="history-list">{items.slice(0, 8).map(item => <button key={item.id} className={`history-item ${selected?.id === item.id ? 'history-active' : ''}`} onClick={() => openReport(item)}><span className={`history-dot dot-${assessmentClass(item.assessment)}`} /><span className="history-title">{shortClaim(item.claim)}</span></button>)}{!items.length && !loading && <div className="history-empty">No checks yet</div>}</div>
        <div className="sidebar-bottom"><div className="sidebar-callout"><div className="callout-icon"><Sparkles size={15} /></div><div><strong>Evidence over instinct</strong><p>Every assessment is linked to the evidence behind it.</p></div></div><div className="sidebar-foot"><span>Evidence Desk</span><span>Prototype · v1.0</span></div></div>
      </aside>

      <main className="main-content">
        {error && <div className="global-error"><AlertCircle size={16} /><span>{error}</span><button className="mini-icon" onClick={() => setError('')}><X size={15} /></button></div>}
        {loading && <div className="loading-screen"><LoaderCircle className="spin" size={25} /><span>Loading your workspace…</span></div>}
        {!loading && dashboard && <Dashboard items={filteredItems} total={items.length} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} onCreate={() => openCreate()} onOpen={openReport} />}
        {!loading && isCreateOpen && <CreateInvestigation form={form} setForm={setForm} onSubmit={submit} onCancel={() => setCreateOpen(false)} pending={pending} demoSources={demoSources} fileInput={fileInput} setError={setError} />}
        {!loading && selected && !isCreateOpen && <Report report={selected} onBack={() => setSelected(null)} tab={activeTab} setTab={setActiveTab} />}
      </main>
    </div>
  </div>
}

function Dashboard({ items, total, search, setSearch, filter, setFilter, onCreate, onOpen }) {
  const completed = items.filter(i => i.status === 'complete').length
  const supported = items.filter(i => i.assessment === 'Supported').length
  const contradicted = items.filter(i => i.assessment === 'Contradicted').length
  const inconclusive = items.filter(i => i.assessment === 'Inconclusive').length
  return <div className="page dashboard-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> YOUR WORKSPACE</div><h1>Overview</h1><p>A clear view of what’s been checked, and what the evidence says.</p></div><button className="button button-primary" onClick={onCreate}><Plus size={16} /> New investigation</button></div>
    <div className="stat-grid">
      <StatCard icon={FileCheck2} label="Investigations" value={total} note="Saved to your workspace" color="green" />
      <StatCard icon={BadgeCheck} label="Supported" value={supported} note="Evidence aligns with claim" color="blue" />
      <StatCard icon={AlertCircle} label="Contradicted" value={contradicted} note="Evidence conflicts with claim" color="rose" />
      <StatCard icon={CircleHelp} label="Inconclusive" value={inconclusive} note="More evidence is needed" color="amber" />
    </div>
    <div className="section-heading"><div><h2>Recent investigations</h2><p>Your evidence trail, all in one place.</p></div><button className="text-button" onClick={onCreate}>View all <ArrowRight size={14} /></button></div>
    <div className="table-toolbar"><div className="search-box"><Search size={16} /><input aria-label="Search claims" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search claims…" /></div><label className="filter-select"><Filter size={14} /><select aria-label="Filter by assessment" value={filter} onChange={e => setFilter(e.target.value)}><option>All checks</option><option>Supported</option><option>Contradicted</option><option>Inconclusive</option></select><ChevronDown size={14} /></label></div>
    <div className="investigation-table"><div className="table-header"><span>CLAIM / MESSAGE</span><span>ASSESSMENT</span><span>SOURCES</span><span>DATE</span><span /></div>{items.map(item => <button key={item.id} className="table-row" onClick={() => onOpen(item)}><div className="claim-cell"><span className="file-icon"><FileText size={17} /></span><span><strong>{shortClaim(item.claim)}</strong><small>{item.filename ? `Includes ${item.filename}` : 'Claim investigation'}</small></span></div><div><AssessmentBadge assessment={item.assessment} small /></div><div className="source-count"><Globe2 size={14} />{item.sources_count} {item.sources_count === 1 ? 'source' : 'sources'}</div><div className="date-cell">{formatDate(item.created_at)}</div><ArrowUpRight size={15} className="row-arrow" /></button>)}{!items.length && <EmptyState onCreate={onCreate} />}</div>
    <div className="dashboard-foot"><span><LockKeyhole size={12} /> Investigations are stored locally on this device.</span><span>{completed} complete</span></div>
  </div>
}

function StatCard({ icon: Icon, label, value, note, color }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon stat-${color}`}><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>
}

function CreateInvestigation({ form, setForm, onSubmit, onCancel, pending, demoSources, fileInput, setError }) {
  const [sourceText, setSourceText] = useState('')
  const [dragging, setDragging] = useState(false)
  const addSource = () => {
    const url = sourceText.trim(); if (!url) return
    setForm(f => ({ ...f, sources: [...new Set([...f.sources, url])] })); setSourceText('')
  }
  const setFile = file => {
    if (!file) return
    setError('')
    if (!/\.(png|jpe?g|webp|pdf)$/i.test(file.name)) { setError('Unsupported file type. Upload PNG, JPG, WEBP, or PDF.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('File exceeds the 10 MB upload limit.'); return }
    setForm(f => ({ ...f, file }))
  }
  return <div className="page create-page">
    <button className="back-link" onClick={onCancel}><ArrowLeft size={15} /> Back to overview</button>
    <div className="create-heading"><div className="create-icon"><ShieldCheck size={22} /></div><div><div className="eyebrow">NEW INVESTIGATION</div><h1>Follow the evidence.</h1><p>Bring together a claim, the original content, and trustworthy sources.</p></div></div>
    <form className="investigation-form" onSubmit={onSubmit}>
      <div className="form-section"><div className="form-section-head"><span className="step-number">01</span><div><h2>What claim do you want to check?</h2><p>Keep it specific. One claim at a time makes evidence easier to evaluate.</p></div></div><label className="field-label" htmlFor="claim">Claim to verify <span>Required</span></label><textarea id="claim" className="text-input claim-input" required maxLength={1200} rows={3} placeholder="e.g. The university has cancelled all examinations this week" value={form.claim} onChange={e => setForm(f => ({ ...f, claim: e.target.value }))} /><div className="input-meta"><span>Write the statement as it was shared.</span><span>{form.claim.length}/1,200</span></div><label className="field-label message-label" htmlFor="message">Original message <span className="optional-tag">Optional</span></label><textarea id="message" className="text-input" rows={2} maxLength={5000} placeholder="Paste the forwarded message or add context…" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} /></div>
      <div className="form-divider" />
      <div className="form-section"><div className="form-section-head"><span className="step-number">02</span><div><h2>Add the original content</h2><p>We’ll inspect its file details. Metadata alone can’t establish authenticity.</p></div></div><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={e => setFile(e.target.files?.[0])} /><div className={`upload-zone ${dragging ? 'upload-dragging' : ''} ${form.file ? 'upload-has-file' : ''}`} onClick={() => !form.file && fileInput.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); setFile(e.dataTransfer.files?.[0]) }} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && fileInput.current?.click()}><span className="upload-icon">{form.file ? <FileCheck2 size={20} /> : <ImagePlus size={20} />}</span><div className="upload-copy"><strong>{form.file ? form.file.name : 'Drop a file here, or browse'}</strong><span>{form.file ? `${(form.file.size / 1024).toFixed(0)} KB · Ready for inspection` : 'PNG, JPG, WEBP, or PDF · Up to 10 MB'}</span></div>{form.file ? <button type="button" className="remove-file" onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, file: null })); if (fileInput.current) fileInput.current.value = '' }} aria-label="Remove file"><X size={16} /></button> : <button type="button" className="browse-button" onClick={e => { e.stopPropagation(); fileInput.current?.click() }}>Browse files</button>}</div></div>
      <div className="form-divider" />
      <div className="form-section"><div className="form-section-head"><span className="step-number">03</span><div><h2>Where should we look for evidence?</h2><p>Provide a source URL. Only allowlisted official domains are fetched.</p></div></div><div className="url-entry"><Globe2 size={16} /><input value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="https://university.edu/announcements" onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSource())} /><button type="button" className="button button-subtle" onClick={addSource}><Plus size={15} /> Add source</button></div>{!!form.sources.length && <div className="source-chips">{form.sources.map(url => <span className="source-chip" key={url}><span className="source-chip-dot" />{url}<button type="button" aria-label="Remove source" onClick={() => setForm(f => ({ ...f, sources: f.sources.filter(s => s !== url) }))}><X size={13} /></button></span>)}</div>}<div className="fixture-box"><div className="fixture-label"><Sparkles size={14} /><span>TRY THE DEMO</span><span className="synthetic-pill">Synthetic sources</span></div><div className="fixture-actions"><button type="button" onClick={() => { setForm(f => ({ ...f, claim: initialSamples[0].claim, message: initialSamples[0].message, sources: demoSources[0] ? [demoSources[0].url] : f.sources })); }}>Exam cancellation notice <ArrowUpRight size={13} /></button><button type="button" onClick={() => { setForm(f => ({ ...f, claim: initialSamples[1].claim, message: initialSamples[1].message, sources: demoSources[1] ? [demoSources[1].url] : f.sources })); }}>Exams continue notice <ArrowUpRight size={13} /></button></div><p>These labeled fixtures are fictional and demonstrate the evidence workflow.</p></div></div>
      <div className="form-footer"><span><LockKeyhole size={13} /> Files are processed locally and are not shared.</span><div><button type="button" className="button button-ghost" onClick={onCancel}>Cancel</button><button type="submit" className="button button-primary" disabled={pending || !form.claim.trim()}>{pending ? <><LoaderCircle size={15} className="spin" /> Checking…</> : <><ShieldCheck size={16} /> Investigate claim</>}</button></div></div>
    </form>
  </div>
}

function Report({ report, onBack, tab, setTab }) {
  const [showLimitations, setShowLimitations] = useState(false)
  const file = report.file
  return <div className="page report-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> All investigations</button>
    <div className="report-topline"><div className="eyebrow"><span className="eyebrow-dot" /> INVESTIGATION REPORT <span className="report-id">ID {report.id?.slice(0, 8).toUpperCase()}</span></div><button className="button button-ghost button-export" onClick={() => window.print()}><FileText size={15} /> Save report</button></div>
    <h1 className="report-title">{report.claim}</h1><div className="report-meta"><span><Clock3 size={14} /> Checked {formatDate(report.checked_at)}</span><span className="meta-separator">·</span><span>Evidence Desk analysis</span></div>
    <div className={`verdict-card verdict-${assessmentClass(report.assessment)}`}><div className="verdict-icon">{report.assessment === 'Supported' ? <BadgeCheck size={23} /> : report.assessment === 'Contradicted' ? <AlertCircle size={23} /> : <CircleHelp size={23} />}</div><div className="verdict-copy"><span className="verdict-label">OVERALL ASSESSMENT</span><h2>{report.assessment}</h2><p>{report.summary}</p></div><span className="verdict-honesty"><ShieldCheck size={14} /> Evidence-linked</span></div>
    <div className="report-tabs"><button onClick={() => setTab('overview')} className={tab === 'overview' ? 'tab-active' : ''}>Evidence overview</button><button onClick={() => setTab('checks')} className={tab === 'checks' ? 'tab-active' : ''}>Checks performed <span>{report.checks?.length || 0}</span></button></div>
    {tab === 'checks' ? <div className="checks-list">{report.checks?.map((check, i) => <div className="check-row" key={check.name}><span className="check-step">0{i + 1}</span><div><strong>{check.name}</strong><p>{check.result}</p><small>{check.evidence}</small></div><Check size={17} className="check-mark" /></div>)}</div> : <div className="report-columns"><div className="report-main-column">
      <section className="report-section"><div className="section-title-row"><div><span className="section-kicker">SOURCE REVIEW</span><h2>What the sources say</h2></div><span className="source-total"><Globe2 size={13} /> {report.sources?.length || 0} checked</span></div>{!report.sources?.length && <div className="no-sources"><div className="no-source-icon"><Search size={18} /></div><strong>No usable sources provided</strong><p>We couldn’t establish this claim from evidence because no source was supplied.</p></div>}{report.sources?.map((source, i) => <SourceCard key={`${source.url}-${i}`} source={source} />)}</section>
      {file && <section className="report-section file-report"><div className="section-title-row"><div><span className="section-kicker">FILE INSPECTION</span><h2>What we could inspect</h2></div><span className="source-total">{file.file_type}</span></div><div className="file-summary"><span className="file-preview-icon">{file.extension === '.pdf' ? <FileText size={19} /> : <FileImage size={19} />}</span><div className="file-name-block"><strong>{file.filename}</strong><span>{file.dimensions ? `${file.dimensions.width} × ${file.dimensions.height} px · ` : ''}{(file.size_bytes / 1024).toFixed(0)} KB</span></div><span className="file-inspected"><Check size={13} /> Inspected</span></div><div className="metadata-box"><div className="metadata-head"><span>AVAILABLE METADATA</span><span>{Object.keys(file.metadata || {}).length} field(s)</span></div>{Object.entries(file.metadata || {}).map(([key, value]) => <div className="metadata-row" key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{value}</strong></div>)}</div>{file.indicators?.map((indicator, i) => <div className="indicator-row" key={i}><span className="indicator-mark"><CircleHelp size={14} /></span><div><strong>{indicator.label} · {indicator.result}</strong><p>{indicator.explanation}</p></div></div>)}</section>}
    </div><aside className="report-side-column"><div className="side-card"><div className="side-card-title"><FileText size={15} /><strong>Original claim</strong></div><p className="original-claim">“{report.claim}”</p>{report.original_message && <><div className="side-divider"/><span className="side-label">MESSAGE CONTEXT</span><p className="original-message">{report.original_message}</p></>}</div><div className="side-card checks-summary"><div className="side-card-title"><Activity size={15} /><strong>Checks performed</strong></div>{report.checks?.map((check, i) => <div className="summary-check" key={check.name}><span className="summary-check-num">0{i + 1}</span><span>{check.name}</span><Check size={13} /></div>)}<button className="text-button" onClick={() => setTab('checks')}>View all checks <ArrowRight size={13} /></button></div><button className="limitations-toggle" onClick={() => setShowLimitations(!showLimitations)}><span><AlertCircle size={15} /> Limitations &amp; method</span><ChevronDown size={15} className={showLimitations ? 'rotated' : ''} /></button>{showLimitations && <div className="limitations-list">{report.limitations?.map((limitation, i) => <p key={i}>{limitation}</p>)}</div>}</aside></div>}
    <footer className="report-disclaimer"><ShieldCheck size={14} /><span>This is an evidence summary, not a declaration of truth. Review the sources and context before acting.</span></footer>
  </div>
}

function SourceCard({ source }) {
  const label = source.relation === 'supports' ? 'Supports claim' : source.relation === 'contradicts' ? 'Contradicts claim' : source.relation === 'unclear' ? 'Does not establish' : 'Unavailable'
  return <article className="source-card"><div className="source-card-top"><span className={`relation-badge relation-${source.relation}`}><span className="relation-dot" />{label}</span>{source.synthetic && <span className="synthetic-pill"><Sparkles size={11} /> Synthetic fixture</span>}</div><a className="source-title" href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}<ArrowUpRight size={14} /></a><div className="source-url"><Globe2 size={12} />{source.url}</div>{source.evidence_excerpt && <blockquote className="evidence-quote">“{source.evidence_excerpt}”</blockquote>}<p className="source-reason">{source.reason}</p><div className="source-card-foot"><span><Clock3 size={12} /> Retrieved {formatDate(source.retrieved_at)}</span><a href={source.url} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={12} /></a></div></article>
}
