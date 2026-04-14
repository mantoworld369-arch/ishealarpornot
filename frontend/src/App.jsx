import { useState, useEffect, useCallback } from "react";

async function searchDexScreener(ticker) {
  const symbol = ticker.replace("$", "").toUpperCase();
  try {
    const res = await fetch(`/api/dex/search?q=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.pairs || !data.pairs.length) return null;
    const sorted = data.pairs
      .filter((p) => p.baseToken.symbol.toUpperCase() === symbol && p.liquidity?.usd > 0)
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const best = sorted[0] || data.pairs[0];
    return {
      name: best.baseToken.name, chain: best.chainId,
      priceUsd: parseFloat(best.priceUsd) || 0,
      priceChange24h: best.priceChange?.h24 || 0, priceChange6h: best.priceChange?.h6 || 0,
      priceChange1h: best.priceChange?.h1 || 0, priceChange5m: best.priceChange?.m5 || 0,
      liquidity: best.liquidity?.usd || 0, fdv: best.fdv || 0,
      marketCap: best.marketCap || 0, volume24h: best.volume?.h24 || 0,
      url: best.url, imageUrl: best.info?.imageUrl || null,
    };
  } catch { return null; }
}

async function discoverTweets(handle) {
  const res = await fetch("/api/tweets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-search-preview", max_tokens: 4000,
      messages: [{ role: "user", content: `Search for the crypto Twitter/X account @${handle}. Find what cryptocurrency tokens they have tweeted about or promoted in the past year.

Search for: "@${handle} crypto", "@${handle} token", "from:${handle} $"

For each ticker found provide symbol, dates, what they said, mention count.

Respond ONLY with valid JSON, no markdown:
{
  "handle": "${handle}",
  "bio": "brief description",
  "followerCount": "approximate",
  "tickers": [
    { "symbol": "SOL", "mentions": [{ "date": "2025-01-15", "sentiment": "bullish", "text": "paraphrased tweet", "engagement": "high" }], "totalMentions": 5, "overallSentiment": "bullish" }
  ],
  "shillFrequency": "X tweets per week",
  "topTicker": "$SOL"
}` }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Could not parse tweet data");
  return JSON.parse(m[0].replace(/```json|```/g, "").trim());
}

async function getVerdict(shillData, model) {
  const res = await fetch("/api/verdict", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0.7, max_tokens: 500,
      messages: [{ role: "user", content: `You are a brutally honest crypto analyst. Data for @${shillData.handle}:
- Bio: ${shillData.bio} | Followers: ${shillData.followerCount}
- Shill frequency: ${shillData.shillFrequency} | Tickers: ${shillData.tickers.length} | Top: ${shillData.topTicker}

Tickers (DexScreener live):
${shillData.enrichedTickers.map((t) => `  ${t.ticker}: ${t.totalMentions}x, ${t.overallSentiment}, $${t.currentPrice}, 24h=${t.priceChange24h}%, liq=$${(t.liquidity/1000).toFixed(0)}k`).join("\n")}

Respond ONLY in valid JSON:
{"verdict":"Catchy label","confidence":75,"summary":"2-3 sentence roast","risk":"SAFE or CAUTION or DANGER","bestCall":"$X - reason","worstCall":"$X - reason"}` }],
    }),
  });
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Could not parse verdict");
  return JSON.parse(m[0].replace(/```json|```/g, "").trim());
}

const MODELS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", cost: "$0.15/M" },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku", cost: "$0.25/M" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini Flash", cost: "$0.10/M" },
  { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B", cost: "$0.05/M" },
];

export default function App() {
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(-1);
  const [report, setReport] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState(null);
  const [expandedTicker, setExpandedTicker] = useState(null);
  const [model, setModel] = useState(MODELS[0].id);
  const [showSettings, setShowSettings] = useState(false);
  const [glitch, setGlitch] = useState("IS HE A SHILL OR NOT");
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const o = "IS HE A SHILL OR NOT";
    const iv = setInterval(() => { let r = ""; for (let i = 0; i < o.length; i++) r += Math.random() < 0.06 ? c[Math.floor(Math.random() * c.length)] : o[i]; setGlitch(r); }, 100);
    return () => clearInterval(iv);
  }, []);

  const log = useCallback((m) => setLogs((p) => [...p, { t: new Date().toLocaleTimeString(), m }]), []);
  const clean = handle.replace("@", "").trim();

  const PHASES = [`Searching X for @${clean}...`, "Extracting tickers...", "Querying DexScreener...", "Calculating metrics...", "AI verdict via OpenRouter...", "Done!"];

  const run = useCallback(async () => {
    if (!clean) return;
    setLoading(true); setReport(null); setVerdict(null); setError(null); setExpandedTicker(null); setLogs([]);
    try {
      setPhaseIdx(0); log("Searching web for tweets...");
      const tw = await discoverTweets(clean);
      log(`Found ${tw.tickers?.length || 0} tickers`);
      if (!tw.tickers?.length) throw new Error(`No crypto tickers found for @${clean}`);

      setPhaseIdx(1); log(`Tickers: ${tw.tickers.map((t) => "$" + t.symbol).join(", ")}`);
      setPhaseIdx(2);
      const enriched = [];
      for (const t of tw.tickers) {
        const sym = t.symbol.replace("$", "").toUpperCase();
        log(`  → $${sym}...`);
        const dex = await searchDexScreener(sym);
        await new Promise((r) => setTimeout(r, 350));
        enriched.push({
          ticker: "$" + sym, name: dex?.name || sym, chain: dex?.chain || "?",
          currentPrice: dex?.priceUsd || 0, priceChange24h: dex?.priceChange24h || 0,
          priceChange6h: dex?.priceChange6h || 0, priceChange1h: dex?.priceChange1h || 0,
          priceChange5m: dex?.priceChange5m || 0, liquidity: dex?.liquidity || 0,
          fdv: dex?.fdv || 0, marketCap: dex?.marketCap || 0, volume24h: dex?.volume24h || 0,
          pairUrl: dex?.url || `https://dexscreener.com/search?q=${sym}`,
          imageUrl: dex?.imageUrl, totalMentions: t.totalMentions || t.mentions?.length || 1,
          overallSentiment: t.overallSentiment || "neutral", mentions: t.mentions || [], dexFound: !!dex,
        });
        log(dex ? `  ✓ $${sym}: $${dex.priceUsd}` : `  ✗ $${sym}: not on DEX`);
      }
      enriched.sort((a, b) => b.totalMentions - a.totalMentions);

      setPhaseIdx(3);
      const rd = { handle: clean, bio: tw.bio, followerCount: tw.followerCount, shillFrequency: tw.shillFrequency, topTicker: tw.topTicker, tickers: tw.tickers, enrichedTickers: enriched, totalTickers: enriched.length, totalTweets: enriched.reduce((s, t) => s + t.totalMentions, 0) };

      setPhaseIdx(4); log(`Calling OpenRouter (${model.split("/").pop()})...`);
      const v = await getVerdict(rd, model);
      log(`Verdict: "${v.verdict}" | ${v.risk}`);

      setPhaseIdx(5); setReport(rd); setVerdict(v);
    } catch (e) { setError(e.message); log(`ERROR: ${e.message}`); }
    finally { setLoading(false); }
  }, [clean, model, log]);

  const rc = (r) => r === "SAFE" ? "#00ff41" : r === "CAUTION" ? "#ffc800" : "#ff3232";
  const sc = (s) => !s ? "#666" : s.toLowerCase().includes("bull") ? "#00ff41" : s.toLowerCase().includes("bear") ? "#ff3232" : "#ffc800";
  const cc = (v) => !v ? "#666" : v > 0 ? "#00ff41" : "#ff3232";
  const fp = (p) => !p ? "N/A" : p < 0.000001 ? "$" + p.toExponential(2) : p < 0.01 ? "$" + p.toFixed(6) : p < 1 ? "$" + p.toFixed(4) : p < 1000 ? "$" + p.toFixed(2) : "$" + p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fm = (v) => !v ? "N/A" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e0e0e0", fontFamily: "'IBM Plex Mono','Fira Code',monospace" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999, background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)" }} />
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 16px", position: "relative", zIndex: 1 }}>

        <header style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: 6, color: "#00ff41", opacity: 0.4, marginBottom: 6 }}>▲ CRYPTO TWITTER FORENSICS ▲</div>
          <h1 style={{ fontSize: "clamp(26px,5vw,46px)", fontWeight: 700, letterSpacing: -1, color: "#00ff41", textShadow: "0 0 30px rgba(0,255,65,0.3)", margin: "0 0 6px", lineHeight: 1.1 }}>{glitch}</h1>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {[{ l: "DEXSCREENER", c: "0,255,65" }, { l: "OPENROUTER", c: "255,200,0" }, { l: "WEB SEARCH", c: "0,191,255" }].map((b) => (
              <span key={b.l} style={{ padding: "3px 10px", border: `1px solid rgba(${b.c},0.2)`, fontSize: 9, letterSpacing: 2, color: `rgba(${b.c},0.5)` }}>{b.l}</span>
            ))}
          </div>
        </header>

        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: "transparent", border: "1px solid rgba(0,255,65,0.15)", color: "#00ff41", fontFamily: "inherit", fontSize: 11, letterSpacing: 2, padding: "8px 16px", cursor: "pointer", opacity: 0.7, width: "100%", textAlign: "left" }}>
            {showSettings ? "▼" : "▶"} MODEL SETTINGS
          </button>
          {showSettings && (
            <div style={{ border: "1px solid rgba(0,255,65,0.1)", borderTop: "none", padding: 20, background: "rgba(0,255,65,0.02)" }}>
              <label style={{ display: "block", fontSize: 10, letterSpacing: 2, color: "#666", marginBottom: 6 }}>VERDICT MODEL</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => setModel(m.id)} style={{ padding: "8px 14px", background: model === m.id ? "rgba(0,255,65,0.15)" : "rgba(0,0,0,0.3)", border: `1px solid ${model === m.id ? "#00ff41" : "rgba(0,255,65,0.1)"}`, color: model === m.id ? "#00ff41" : "#666", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>
                    {m.label}<span style={{ display: "block", fontSize: 9, color: "#555", marginTop: 2 }}>{m.cost}</span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#444", marginTop: 12 }}>Keys are stored on your server in .env — never exposed to browser.</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 0, marginBottom: 24, border: "1px solid rgba(0,255,65,0.3)", background: "rgba(0,255,65,0.02)" }}>
          <div style={{ padding: "14px 16px", color: "#00ff41", fontSize: 16, borderRight: "1px solid rgba(0,255,65,0.15)", display: "flex", alignItems: "center", background: "rgba(0,255,65,0.05)" }}>@</div>
          <input type="text" placeholder="enter twitter handle..." value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !loading && run()} style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#00ff41", fontSize: 16, fontFamily: "inherit", padding: "14px 16px", letterSpacing: 1 }} />
          <button onClick={run} disabled={loading || !handle.trim()} style={{ padding: "14px 28px", background: loading ? "rgba(0,255,65,0.1)" : "#00ff41", color: loading ? "#00ff41" : "#0a0a0a", border: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 700, letterSpacing: 2, cursor: loading ? "wait" : "pointer", textTransform: "uppercase" }}>
            {loading ? "SCANNING..." : "ANALYZE"}
          </button>
        </div>

        {error && <div style={{ border: "1px solid rgba(255,50,50,0.3)", background: "rgba(255,50,50,0.05)", padding: 16, marginBottom: 20, fontSize: 13, color: "#ff6666" }}>⚠ {error}</div>}

        {loading && (
          <div style={{ border: "1px solid rgba(0,255,65,0.15)", padding: 24, marginBottom: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(0,255,65,0.4)", marginBottom: 16 }}>ANALYZING @{clean}</div>
            {PHASES.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0", opacity: i <= phaseIdx ? 1 : 0.2 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: i < phaseIdx ? "#00ff41" : i === phaseIdx ? "#ffc800" : "#333", boxShadow: i === phaseIdx ? "0 0 8px #ffc800" : "none" }} />
                <span style={{ fontSize: 12, color: i <= phaseIdx ? "#00ff41" : "#444" }}>{p}</span>
                {i === phaseIdx && <span style={{ color: "#ffc800", animation: "blink 1s infinite" }}>█</span>}
              </div>
            ))}
            {logs.length > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(0,255,65,0.08)", maxHeight: 200, overflowY: "auto", fontSize: 11, lineHeight: 1.8 }}>
                {logs.map((l, i) => <div key={i} style={{ color: l.m.startsWith("ERROR") ? "#ff3232" : l.m.includes("✓") ? "#00ff41" : l.m.includes("✗") ? "#ff6666" : "#888" }}><span style={{ color: "#444" }}>[{l.t}]</span> {l.m}</div>)}
              </div>
            )}
            <style>{`@keyframes blink{0%,50%{opacity:1}51%,100%{opacity:0}}`}</style>
          </div>
        )}

        {report && verdict && (
          <div style={{ animation: "fadeIn .5s ease" }}>
            <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1}}`}</style>
            <div style={{ padding: "16px 20px", border: "1px solid rgba(0,255,65,0.1)", marginBottom: 2, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(0,255,65,0.1)", border: "1px solid rgba(0,255,65,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#00ff41" }}>@</div>
              <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 18, fontWeight: 700, color: "#00ff41" }}>@{report.handle}</div><div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{report.bio}</div></div>
              <div style={{ fontSize: 11, color: "#555" }}>{report.followerCount} followers</div>
            </div>
            <div style={{ border: `1px solid ${rc(verdict.risk)}33`, background: `${rc(verdict.risk)}08`, padding: 28, marginBottom: 2, position: "relative" }}>
              <div style={{ position: "absolute", top: 12, right: 16, padding: "3px 10px", border: `1px solid ${rc(verdict.risk)}`, color: rc(verdict.risk), fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>{verdict.risk}</div>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(0,255,65,0.4)", marginBottom: 6 }}>AI PERSONALITY VERDICT</div>
              <div style={{ fontSize: "clamp(20px,4vw,30px)", fontWeight: 700, color: rc(verdict.risk), textShadow: `0 0 20px ${rc(verdict.risk)}40`, marginBottom: 12 }}>"{verdict.verdict}"</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: "#b0b0b0", maxWidth: 620, marginBottom: 16 }}>{verdict.summary}</div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 11 }}>
                <div><span style={{ color: "#555" }}>CONFIDENCE </span><span style={{ color: "#00ff41", fontWeight: 700 }}>{verdict.confidence}%</span></div>
                <div><span style={{ color: "#555" }}>MODEL </span><span style={{ color: "#888" }}>{model.split("/").pop()}</span></div>
                {verdict.bestCall && <div><span style={{ color: "#555" }}>BEST </span><span style={{ color: "#00ff41" }}>{verdict.bestCall}</span></div>}
                {verdict.worstCall && <div><span style={{ color: "#555" }}>WORST </span><span style={{ color: "#ff3232" }}>{verdict.worstCall}</span></div>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 1, marginBottom: 2, background: "rgba(0,255,65,0.1)" }}>
              {[{ l: "TICKERS", v: report.totalTickers, c: "#ffc800" }, { l: "MENTIONS", v: report.totalTweets, c: "#00ff41" }, { l: "FREQUENCY", v: report.shillFrequency, c: "#00bfff" }, { l: "TOP", v: report.topTicker, c: "#ffc800" }].map((s, i) => (
                <div key={i} style={{ padding: "16px 18px", background: "#0a0a0a", textAlign: "center" }}><div style={{ fontSize: 9, letterSpacing: 2, color: "#555", marginBottom: 4 }}>{s.l}</div><div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div></div>
              ))}
            </div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(0,255,65,0.4)", margin: "20px 0 10px 4px" }}>TICKER BREAKDOWN — DEXSCREENER LIVE</div>
            {report.enrichedTickers.map((td, ti) => {
              const isOpen = expandedTicker === ti;
              return (
                <div key={td.ticker} style={{ border: "1px solid rgba(0,255,65,0.1)", marginBottom: 2, background: isOpen ? "rgba(0,255,65,0.03)" : "transparent" }}>
                  <div onClick={() => setExpandedTicker(isOpen ? null : ti)} style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: 14, flexWrap: "wrap" }}>
                    {td.imageUrl && <img src={td.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} onError={(e) => { e.target.style.display = "none"; }} />}
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#ffc800", minWidth: 70 }}>{td.ticker}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>{td.name} • {td.chain}</span>
                    <span style={{ fontSize: 11, color: "#666" }}>{td.totalMentions}x</span>
                    <span style={{ fontSize: 11, color: sc(td.overallSentiment), fontStyle: "italic" }}>{td.overallSentiment}</span>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: td.dexFound ? "#e0e0e0" : "#444" }}>{td.dexFound ? fp(td.currentPrice) : "—"}</div>
                      {td.dexFound && <div style={{ fontSize: 11, color: cc(td.priceChange24h), fontWeight: 600 }}>{td.priceChange24h > 0 ? "+" : ""}{td.priceChange24h}%</div>}
                    </div>
                    <span style={{ fontSize: 11, color: "#555", transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform .2s" }}>▶</span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "0 18px 18px", animation: "fadeIn .3s" }}>
                      {td.dexFound && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 1, marginBottom: 16, background: "rgba(0,255,65,0.06)" }}>
                          {[{ l: "PRICE", v: fp(td.currentPrice) }, { l: "MCAP", v: fm(td.marketCap) }, { l: "FDV", v: fm(td.fdv) }, { l: "LIQ", v: fm(td.liquidity) }, { l: "VOL 24H", v: fm(td.volume24h) }, { l: "CHAIN", v: td.chain.toUpperCase() }].map((s, i) => (
                            <div key={i} style={{ padding: "10px 12px", background: "#0a0a0a", fontSize: 11 }}><div style={{ fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 3 }}>{s.l}</div><div style={{ color: "#ccc", fontWeight: 600 }}>{s.v}</div></div>
                          ))}
                        </div>
                      )}
                      {!td.dexFound && <div style={{ padding: 12, background: "rgba(255,200,0,0.05)", border: "1px solid rgba(255,200,0,0.1)", marginBottom: 16, fontSize: 11, color: "#aa8800" }}>Not on DexScreener — CEX only</div>}
                      {td.dexFound && <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>{[{ l: "5m", v: td.priceChange5m }, { l: "1h", v: td.priceChange1h }, { l: "6h", v: td.priceChange6h }, { l: "24h", v: td.priceChange24h }].map((p, i) => <div key={i} style={{ fontSize: 11 }}><span style={{ color: "#555" }}>{p.l}: </span><span style={{ color: cc(p.v), fontWeight: 700 }}>{p.v > 0 ? "+" : ""}{p.v || 0}%</span></div>)}</div>}
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "#555", marginBottom: 8 }}>MENTIONS ({td.mentions.length})</div>
                      <div style={{ maxHeight: 240, overflowY: "auto" }}>
                        {td.mentions.map((m, i) => <div key={i} style={{ padding: "10px 12px", borderLeft: `2px solid ${sc(m.sentiment)}`, marginBottom: 3, background: "rgba(0,0,0,0.2)", fontSize: 12 }}><div style={{ color: "#999", marginBottom: 4 }}>"{m.text}"</div><div style={{ display: "flex", gap: 14, fontSize: 10, color: "#555", flexWrap: "wrap" }}><span>{m.date}</span><span style={{ color: sc(m.sentiment) }}>{m.sentiment}</span><span>{m.engagement}</span></div></div>)}
                      </div>
                      {td.pairUrl && <div style={{ marginTop: 12, fontSize: 11 }}><a href={td.pairUrl} target="_blank" rel="noopener" style={{ color: "#00bfff" }}>View on DexScreener →</a></div>}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ marginTop: 28, padding: "14px 0", borderTop: "1px solid rgba(0,255,65,0.1)", fontSize: 10, color: "#333", textAlign: "center", letterSpacing: 1 }}>DEXSCREENER • OPENROUTER • NOT FINANCIAL ADVICE</div>
          </div>
        )}

        {!report && !loading && !error && (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🔍</div>
            <div style={{ fontSize: 12, maxWidth: 420, margin: "0 auto", lineHeight: 1.9, color: "#555" }}>Enter any crypto Twitter handle to generate a live shill report.</div>
          </div>
        )}
      </div>
    </div>
  );
}
