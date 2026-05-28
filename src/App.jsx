import { useState, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6'
const API_URL = 'https://api.anthropic.com/v1/messages'

const TONE_OPTIONS = [
  { value: 'friendly_direct', label: 'Friendly & Direct' },
  { value: 'professional',    label: 'Professional' },
  { value: 'casual',          label: 'Casual' },
  { value: 'persuasive',      label: 'Persuasive' },
  { value: 'custom',          label: 'Custom…' },
]

const STATUS_STEPS = [
  { label: 'Initialising agent',    detail: 'Preparing the research pipeline…' },
  { label: 'Searching the web',     detail: 'Finding real businesses in your area…' },
  { label: 'Gathering intel',       detail: 'Reading business profiles and online presence…' },
  { label: 'Analysing fit',         detail: 'Scoring each prospect against your offer…' },
  { label: 'Writing emails',        detail: 'Personalising outreach for each business…' },
  { label: 'Compiling results',     detail: 'Formatting and returning your prospect cards…' },
]

const PRIORITY_STYLE = {
  High:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  Medium: 'bg-amber-500/10  text-amber-400  border-amber-500/25',
  Low:    'bg-slate-500/10  text-slate-400  border-slate-500/25',
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // ── API key
  const [apiKey,   setApiKey]   = useState('')
  const [showKey,  setShowKey]  = useState(false)

  // ── Form fields
  const [targetType,  setTargetType]  = useState('')
  const [location,    setLocation]    = useState('')
  const [offer,       setOffer]       = useState('')
  const [tone,        setTone]        = useState('friendly_direct')
  const [customTone,  setCustomTone]  = useState('')
  const [count,       setCount]       = useState(5)

  // ── Run state
  const [loading,    setLoading]    = useState(false)
  const [statusIdx,  setStatusIdx]  = useState(0)
  const [error,      setError]      = useState('')

  // ── Results
  const [prospects, setProspects] = useState([])
  const [filter,    setFilter]    = useState('All')
  const [copied,    setCopied]    = useState({})

  const timerRef = useRef(null)

  // ── Helpers

  const activeTone = () =>
    tone === 'custom'
      ? customTone || 'Friendly & Direct'
      : TONE_OPTIONS.find(t => t.value === tone)?.label ?? tone

  const systemPrompt = () => `You are a B2B prospect research agent.

OUTPUT FORMAT — THIS IS MANDATORY:
Your ENTIRE response must be a raw JSON array. Start with [ and end with ]. No text before the [. No text after the ]. No markdown. No code fences. No explanation. No preamble. Just the JSON array.

If inputs are vague or broad, make reasonable assumptions and still return the JSON array.

TASK:
1. Use web_search to find ${count} real ${targetType || 'local'} businesses in ${location || 'the UK'}
2. Research each — find their online presence, what they do, how they operate
3. Assess fit against the offer: "${offer || 'general business services'}"
4. Write a personalised outreach email for each using real intel

Each array object must have exactly these fields:
{
  "name": "Real business name",
  "type": "their business type",
  "location": "their specific town/area",
  "intel": "2-3 sentences of specific intel from your research",
  "fit_reason": "why this offer fits this specific business",
  "priority": "High",
  "email_subject": "compelling subject line",
  "email_body": "full personalised email body — do not repeat the subject line"
}

Priority: High = clear fit and active business, Medium = reasonable fit, Low = uncertain fit.
Email tone: ${activeTone()}

REMEMBER: Respond with ONLY the JSON array. Nothing else.`

  // userMessage is now built inline in runResearch after the clarification step

  // ── Core API loop

  async function callAPI(messages) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     apiKey,
        'anthropic-version': '2023-06-01',
        // This header tells Anthropic's servers that we're calling from a browser
        // intentionally — without it the request would be blocked by CORS
        'anthropic-dangerous-direct-browser-access': 'true',
        // Required to enable the built-in web search tool
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 4000,
        system:     systemPrompt(),
        // web_search_20250305 is Anthropic's built-in web search tool.
        // Claude calls it server-side — we don't have to implement searching ourselves.
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
    }
    return res.json()
  }

  async function runResearch() {
    // Validate
    if (!apiKey.trim())                               { setError('Paste your Anthropic API key above.'); return }
    if (!targetType.trim() || !location.trim() || !offer.trim()) {
      setError('Please fill in target type, location, and your offer.'); return
    }

    setLoading(true)
    setError('')
    setProspects([])
    setStatusIdx(0)

    // Step through status messages while the agent runs
    timerRef.current = setInterval(() => {
      setStatusIdx(i => Math.min(i + 1, STATUS_STEPS.length - 1))
    }, 5000)

    try {
      // ── Stage 1: Intent clarification ──────────────────────────────────────
      // If inputs are vague, this first call turns them into specific, searchable
      // terms before we run the main research. This is a multi-stage agent pipeline.
      // Even with specific inputs this step is fast and improves result quality.
      const clarifyResp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'anthropic-beta': 'web-search-2025-03-05',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 300,
          system: `You are a search query interpreter. Given vague or specific business research inputs, return a JSON object with two fields:
{
  "business_type": "a specific, searchable business type (e.g. 'independent phone repair shops' not 'small businesses')",
  "location": "a specific, searchable location (e.g. 'Falkirk and Stirling, Scotland' not 'central location')"
}
Return ONLY the JSON object. No other text.`,
          messages: [{
            role: 'user',
            content: `Business type: "${targetType}"\nLocation: "${location}"\nOffer context: "${offer}"\n\nInterpret these into specific searchable terms.`
          }]
        })
      })

      let resolvedType = targetType
      let resolvedLocation = location

      if (clarifyResp.ok) {
        const clarifyData = await clarifyResp.json()
        const clarifyText = clarifyData.content?.find(c => c.type === 'text')?.text ?? ''
        try {
          const clarifyJson = JSON.parse(clarifyText.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
          if (clarifyJson.business_type) resolvedType = clarifyJson.business_type
          if (clarifyJson.location) resolvedLocation = clarifyJson.location
        } catch { /* keep original inputs if parsing fails */ }
      }

      // ── Stage 2: Main research loop ────────────────────────────────────────
      // Now run the actual research with the clarified, specific inputs.
      // Claude may decide to search multiple times. Each time it does, the API
      // returns stop_reason: "tool_use". We acknowledge it and call again until
      // we get stop_reason: "end_turn", which means Claude is done.
      const researchMessage = `Find ${count} real ${resolvedType} businesses in ${resolvedLocation}.

My offer: ${offer}
Email tone: ${activeTone()}

Use web_search to find actual businesses. Return ONLY the JSON array.`

      let messages = [{ role: 'user', content: researchMessage }]
      let resultText = null

      for (let i = 0; i < 15; i++) {
        const resp = await callAPI(messages)

        if (resp.stop_reason === 'end_turn') {
          // Done — extract the text block containing our JSON
          const textBlock = resp.content.find(c => c.type === 'text')
          resultText = textBlock?.text ?? null
          break
        }

        if (resp.stop_reason === 'tool_use') {
          // Claude ran a web search. Build the next turn:
          // 1. Add Claude's response (which includes the tool_use block)
          // 2. Add our tool_result acknowledgement (empty content — Anthropic
          //    already executed the search on their servers)
          setStatusIdx(s => Math.min(s + 1, STATUS_STEPS.length - 1))

          // Only keep tool_use blocks in history — stripping thinking blocks and
          // search result content prevents token count from exploding across turns.
          const toolUseOnly = resp.content.filter(c => c.type === 'tool_use')

          messages = [
            ...messages,
            { role: 'assistant', content: toolUseOnly },
            {
              role: 'user',
              content: toolUseOnly.map(tu => ({
                type:        'tool_result',
                tool_use_id: tu.id,
                content:     '',
              })),
            },
          ]
          continue
        }

        // Unexpected stop reason — break and see if we have anything
        break
      }

      if (!resultText) throw new Error('The agent finished without returning data. Try again.')

      // Extract JSON array — try multiple strategies in case Claude adds small amounts of prose
      let jsonStr = null

      // Strategy 1: response is already a clean JSON array
      if (resultText.trim().startsWith('[')) jsonStr = resultText.trim()

      // Strategy 2: JSON array somewhere inside the response
      if (!jsonStr) {
        const m = resultText.match(/\[[\s\S]*\]/)
        if (m) jsonStr = m[0]
      }

      // Strategy 3: JSON inside a markdown code block
      if (!jsonStr) {
        const m = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
        if (m && m[1].trim().startsWith('[')) jsonStr = m[1].trim()
      }

      if (!jsonStr) throw new Error('Could not parse results. Use specific inputs — e.g. "phone repair shops" in "Central Scotland".')

      const parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('The agent returned an empty list. Try more specific inputs.')
      }

      setProspects(parsed)
      setFilter('All')
    } catch (err) {
      setError(err.message)
    } finally {
      clearInterval(timerRef.current)
      setLoading(false)
    }
  }

  // ── Actions

  async function copyEmail(id, subject, body) {
    const text = `Subject: ${subject}\n\n${body}`
    await navigator.clipboard.writeText(text)
    setCopied(prev => ({ ...prev, [id]: true }))
    setTimeout(() => setCopied(prev => ({ ...prev, [id]: false })), 2000)
  }

  function exportCSV() {
    const headers = ['Name', 'Type', 'Location', 'Priority', 'Intel', 'Fit Reason', 'Email Subject', 'Email Body']
    const escape  = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows    = prospects.map(p => [
      p.name, p.type, p.location, p.priority,
      p.intel, p.fit_reason, p.email_subject,
      (p.email_body ?? '').replace(/\n/g, ' '),
    ].map(escape).join(','))

    const csv  = [headers.join(','), ...rows].join('\n')
    const url  = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `prospects-${targetType.replace(/\s+/g, '-')}-${Date.now()}.csv`,
    })
    link.click()
    URL.revokeObjectURL(url)
  }

  // ── Derived

  const filtered = filter === 'All' ? prospects : prospects.filter(p => p.priority === filter)
  const stats = {
    total:  prospects.length,
    high:   prospects.filter(p => p.priority === 'High').length,
    medium: prospects.filter(p => p.priority === 'Medium').length,
    low:    prospects.filter(p => p.priority === 'Low').length,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#07070d] text-gray-100 font-sans">

      {/* ── Header */}
      <header className="border-b border-white/[0.06] px-6 py-5 sticky top-0 z-10 backdrop-blur-sm bg-[#07070d]/80">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold tracking-tight">CL</span>
            </div>
            <div className="leading-none">
              <p className="text-sm font-semibold text-white">Prospect Research</p>
              <p className="text-[11px] text-gray-600 mt-0.5">Carron Labs · AI-powered B2B outreach</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] text-gray-600 font-mono hidden sm:block">claude-sonnet-4 · web_search</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">

        {/* ── API Key panel */}
        <Panel>
          <div className="flex items-center justify-between mb-3">
            <Label text="Anthropic API Key" />
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Get a key →
            </a>
          </div>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-…"
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-mono text-gray-200 placeholder-gray-700 focus:border-indigo-500/60 transition-colors"
            />
            <button
              onClick={() => setShowKey(v => !v)}
              className="px-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-xs text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-[11px] text-gray-700 mt-2">
            Your key stays in this browser tab only — it is never sent to Carron Labs servers.
          </p>
        </Panel>

        {/* ── Search form */}
        <Panel className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Target Business Type"
            value={targetType}
            onChange={setTargetType}
            placeholder="e.g. Phone repair shops"
          />
          <InputField
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Central Scotland"
          />
          <div className="sm:col-span-2">
            <Label text="Your Offer" />
            <textarea
              value={offer}
              onChange={e => setOffer(e.target.value)}
              placeholder="e.g. Fone Unlocker — bulk Skech cases at clearance prices, Falkirk-based repair shop"
              rows={2}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/60 resize-none transition-colors mt-2"
            />
          </div>
          <div>
            <Label text="Email Tone" />
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              className="w-full mt-2 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:border-indigo-500/60 transition-colors"
            >
              {TONE_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {tone === 'custom' && (
              <input
                value={customTone}
                onChange={e => setCustomTone(e.target.value)}
                placeholder="Describe the tone you want…"
                className="w-full mt-2 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/60 transition-colors"
              />
            )}
          </div>
          <div>
            <Label text="Prospects to Find" />
            <select
              value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="w-full mt-2 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:border-indigo-500/60 transition-colors"
            >
              <option value={3}>3 prospects</option>
              <option value={5}>5 prospects</option>
              <option value={10}>10 prospects</option>
            </select>
          </div>
        </Panel>

        {/* ── Run button */}
        <button
          onClick={runResearch}
          disabled={loading}
          className={`
            w-full py-4 rounded-2xl text-sm font-semibold transition-all duration-200 active:scale-[0.99]
            ${loading
              ? 'bg-indigo-900/30 text-indigo-700 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40'}
          `}
        >
          {loading
            ? (STATUS_STEPS[statusIdx]?.label ?? 'Running') + '…'
            : 'Run Prospect Research →'}
        </button>

        {/* ── Loading indicator */}
        {loading && (
          <Panel className="border-indigo-500/20">
            <div className="flex items-start gap-3 mb-4">
              <span className="mt-1 w-2 h-2 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              <div>
                <p className="text-sm text-indigo-300 font-medium leading-none">
                  {STATUS_STEPS[statusIdx]?.label}
                </p>
                <p className="text-xs text-gray-600 mt-1.5">
                  {STATUS_STEPS[statusIdx]?.detail}
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="flex gap-1.5">
              {STATUS_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-all duration-700 ${
                    i <= statusIdx ? 'bg-indigo-500' : 'bg-white/5'
                  }`}
                />
              ))}
            </div>
          </Panel>
        )}

        {/* ── Error */}
        {error && (
          <div className="bg-red-900/15 border border-red-500/25 rounded-2xl px-5 py-4 text-sm text-red-400">
            <span className="font-semibold text-red-300">Error — </span>{error}
          </div>
        )}

        {/* ── Results section */}
        {prospects.length > 0 && (
          <div className="space-y-4">

            {/* Stats row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-sm text-gray-400">{stats.total} prospects found</span>
                <PriorityBadge label="High"   count={stats.high}   color="emerald" />
                <PriorityBadge label="Medium" count={stats.medium} color="amber"   />
                <PriorityBadge label="Low"    count={stats.low}    color="slate"   />
              </div>
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-gray-400 hover:text-white hover:border-white/20 transition-colors"
              >
                ↓ Export CSV
              </button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {['All', 'High', 'Medium', 'Low'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filter === f
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/[0.04] text-gray-500 hover:text-gray-300 border border-white/[0.07]'
                  }`}
                >
                  {f}
                  {f !== 'All' && (
                    <span className="ml-1.5 text-[10px] opacity-60">
                      {stats[f.toLowerCase()]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Prospect cards */}
            <div className="space-y-4">
              {filtered.map((p, i) => (
                <ProspectCard
                  key={`${p.name}-${i}`}
                  prospect={p}
                  copied={!!copied[i]}
                  onCopy={() => copyEmail(i, p.email_subject, p.email_body)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer */}
      <footer className="border-t border-white/[0.05] px-6 py-5 mt-16">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-gray-700">
          <span>Built by Marek · Carron Labs · Falkirk, Scotland</span>
          <span>AI-driven creative and operational tooling</span>
        </div>
      </footer>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ProspectCard
// ─────────────────────────────────────────────────────────────────────────────

function ProspectCard({ prospect, onCopy, copied }) {
  const [expanded, setExpanded] = useState(false)
  const priority = prospect.priority ?? 'Low'

  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 hover:border-white/[0.13] transition-colors">
      {/* Top row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-white text-[15px] leading-snug truncate">
            {prospect.name}
          </h3>
          <p className="text-xs text-gray-600 mt-1">
            {prospect.type} · {prospect.location}
          </p>
        </div>
        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border flex-shrink-0 ${PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.Low}`}>
          {priority}
        </span>
      </div>

      {/* Intel */}
      <div className="mb-3">
        <SectionLabel text="Intel" />
        <p className="text-sm text-gray-300 leading-relaxed mt-1">{prospect.intel}</p>
      </div>

      {/* Fit reason */}
      <div className="mb-4">
        <SectionLabel text="Why it fits" />
        <p className="text-sm text-gray-500 leading-relaxed mt-1">{prospect.fit_reason}</p>
      </div>

      {/* Email block */}
      <div className="bg-black/30 border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionLabel text="Outreach Email" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              {expanded ? 'Collapse' : 'Preview'}
            </button>
            <button
              onClick={onCopy}
              className={`text-xs px-3 py-1 rounded-lg font-medium border transition-all ${
                copied
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/20'
              }`}
            >
              {copied ? '✓ Copied' : 'Copy Email'}
            </button>
          </div>
        </div>

        <p className="text-xs leading-relaxed">
          <span className="text-gray-700">Subject: </span>
          <span className="text-gray-400">{prospect.email_subject}</span>
        </p>

        {expanded && (
          <p className="text-xs text-gray-500 whitespace-pre-wrap mt-3 pt-3 border-t border-white/[0.05] leading-relaxed">
            {prospect.email_body}
          </p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Small reusable components
// ─────────────────────────────────────────────────────────────────────────────

function Panel({ children, className = '' }) {
  return (
    <div className={`bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  )
}

function Label({ text }) {
  return (
    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-widest">
      {text}
    </p>
  )
}

function SectionLabel({ text }) {
  return (
    <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-widest">
      {text}
    </p>
  )
}

function InputField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <Label text={label} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-2 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-700 focus:border-indigo-500/60 transition-colors"
      />
    </div>
  )
}

function PriorityBadge({ label, count, color }) {
  const colors = {
    emerald: 'bg-emerald-500/10 text-emerald-500',
    amber:   'bg-amber-500/10  text-amber-500',
    slate:   'bg-slate-500/10  text-slate-400',
  }
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full ${colors[color]}`}>
      {count} {label}
    </span>
  )
}
