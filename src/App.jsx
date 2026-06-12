import { useState, useMemo, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'
import referentiel from './data/referentiel.json'

const COULEURS = ['Rouge', 'Blanc', 'Rosé', 'Effervescent', 'Liquoreux']
const FORMATS = ['Bouteille (75cl)', 'Demi (37.5cl)', 'Magnum (1.5L)', 'Jéroboam (3L)']
const TYPES_MOUVEMENT = ['Entrée', 'Sortie', 'Ajustement', 'Casse']
const COULEUR_DOT = { Rouge: '#8B2020', Blanc: '#C8A840', Effervescent: '#7090A0', Liquoreux: '#C07820', Rosé: '#D4789A' }
const fmt = (n) => (n === null || n === undefined || n === '') ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

const PAYS_LIST = Object.keys(referentiel)

const EMPTY_FORM = {
  id_bouteille: '', nom: '', producteur: '', millesime: '', couleur: 'Rouge', format: 'Bouteille (75cl)',
  pays: 'France', region: '', appellation: '', cepage: '',
  quantite: 1, emplacement: '',
  date_achat: '', vendeur: '', prix_unitaire: '',
  date_apogee: '', fenetre_consommation: '', notes: '',
  commentaire_degustation: '', note_perso: '', accords: '', photo: null
}

// Calcule le statut selon la même logique que la formule Excel
function calculerStatut(vin) {
  if (!vin.quantite || vin.quantite === 0) return 'Épuisé'
  const annee = new Date().getFullYear()
  if (!vin.date_apogee) return 'En garde'
  if (vin.date_apogee <= annee) return "À boire d'urgence"
  if (vin.date_apogee - annee <= 2) return 'À boire bientôt'
  return 'En garde'
}

const STATUT_COLOR = {
  'Épuisé': '#CCC',
  "À boire d'urgence": '#C04040',
  'À boire bientôt': '#D08820',
  'En garde': '#1A7A3A',
}

// ── UI helpers ───────────────────────────────────────────────────────────
const Spinner = () => (
  <div style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #DDD', borderTopColor: '#111', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
)

const ScoreBadge = ({ label, score }) => (
  <div style={{ textAlign: 'center', padding: '10px 12px', border: '1px solid #E8E8E8', borderRadius: 10, background: '#FAFAFA' }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: score && score >= 95 ? '#1A7A3A' : '#111', lineHeight: 1 }}>{score ?? 'N/D'}</div>
    <div style={{ fontSize: 10, color: '#AAA', marginTop: 4, letterSpacing: 1 }}>{label}</div>
  </div>
)

const StatutPill = ({ statut }) => (
  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: (STATUT_COLOR[statut] || '#CCC') + '18', color: STATUT_COLOR[statut] || '#999' }}>{statut}</span>
)

export default function App() {
  const [vins, setVins] = useState([])
  const [emplacements, setEmplacements] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [degustations, setDegustations] = useState([])
  const [refCustom, setRefCustom] = useState([])
  const [loading, setLoading] = useState(true)
  const [onglet, setOnglet] = useState('inventaire')
  const [filtreCouleur, setFiltreCouleur] = useState('Tous')
  const [filtreStatut, setFiltreStatut] = useState('Tous')
  const [recherche, setRecherche] = useState('')
  const [triPar, setTriPar] = useState('nom')
  const [vinSelectionne, setVinSelectionne] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [repasQuery, setRepasQuery] = useState('')
  const [suggestions, setSuggestions] = useState(null)
  const [loadingIA, setLoadingIA] = useState(false)
  const [loadingCotations, setLoadingCotations] = useState(false)
  const [toast, setToast] = useState(null)
  const [showDegustForm, setShowDegustForm] = useState(false)
  const [degustForm, setDegustForm] = useState({ appreciation: 5, invites: '', commentaires: '', moment_consommation: '', service_temperature: '' })
  const fileRef = useRef()
  const formFileRef = useRef()

  const showToast = (msg, type = 'ok') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  // ── Chargement initial ─────────────────────────────────────────────
  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [v, e, m, d, rc] = await Promise.all([
      supabase.from('vins').select('*').order('nom'),
      supabase.from('emplacements').select('*').order('code'),
      supabase.from('mouvements').select('*, vins(nom, millesime)').order('date', { ascending: false }),
      supabase.from('degustations').select('*, vins(nom, millesime)').order('date_degustation', { ascending: false }),
      supabase.from('referentiel_custom').select('*'),
    ])
    if (v.error) showToast('Erreur de chargement', 'err')
    setVins(v.data || [])
    setEmplacements(e.data || [])
    setMouvements(m.data || [])
    setDegustations(d.data || [])
    setRefCustom(rc.data || [])
    setLoading(false)
  }

  // ── Cascade Pays → Région → Appellation → Cépage (+ entrées personnalisées) ──
  const PAYS_LIST_COMPLET = useMemo(() => {
    const customPays = [...new Set(refCustom.map(r => r.pays))]
    return [...new Set([...PAYS_LIST, ...customPays])]
  }, [refCustom])

  const regionsDisponibles = useMemo(() => {
    const p = formData.pays
    const base = referentiel[p] ? Object.keys(referentiel[p]) : []
    const custom = refCustom.filter(r => r.pays === p).map(r => r.region)
    return [...new Set([...base, ...custom])]
  }, [formData.pays, refCustom])

  const appellationsDisponibles = useMemo(() => {
    const { pays: p, region: r } = formData
    const base = referentiel[p]?.[r] ? Object.keys(referentiel[p][r]) : []
    const custom = refCustom.filter(x => x.pays === p && x.region === r).map(x => x.appellation)
    return [...new Set([...base, ...custom])]
  }, [formData.pays, formData.region, refCustom])

  const cepagesDisponibles = useMemo(() => {
    const { pays: p, region: r, appellation: a } = formData
    const base = referentiel[p]?.[r]?.[a] || []
    const custom = refCustom.filter(x => x.pays === p && x.region === r && x.appellation === a).map(x => x.cepage)
    return [...new Set([...base, ...custom])].filter(c => c !== '—')
  }, [formData.pays, formData.region, formData.appellation, refCustom])

  // ── Ajout d'une nouvelle valeur (région/appellation/cépage) dans le formulaire ──
  const ajouterValeurReferentiel = (niveau) => {
    const labels = { region: 'une région', appellation: 'une appellation', cepage: 'un cépage' }
    const valeur = window.prompt(`Nom de ${labels[niveau]} à ajouter :`)
    if (!valeur || !valeur.trim()) return
    const v = valeur.trim()
    if (niveau === 'region') setFormData(p => ({ ...p, region: v, appellation: '', cepage: '' }))
    if (niveau === 'appellation') setFormData(p => ({ ...p, appellation: v, cepage: '' }))
    if (niveau === 'cepage') setFormData(p => ({ ...p, cepage: v }))
  }

  // ── Enregistre la combinaison Pays/Région/Appellation/Cépage si nouvelle ──
  const sauvegarderReferentielSiNouveau = async (pays, region, appellation, cepage) => {
    if (!pays || !region || !appellation) return
    const cep = cepage || '—'
    const dejaConnu = (referentiel[pays]?.[region]?.[appellation] || []).includes(cep)
      || refCustom.some(r => r.pays === pays && r.region === region && r.appellation === appellation && r.cepage === cep)
    if (dejaConnu) return
    const { data, error } = await supabase.from('referentiel_custom')
      .insert({ pays, region, appellation, cepage: cep })
      .select().single()
    if (!error && data) {
      setRefCustom(p => [...p, data])
      showToast('Nouvelle référence ajoutée à vos listes ✓')
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────
  const vinsAvecStatut = useMemo(() => vins.map(v => ({ ...v, statut: calculerStatut(v) })), [vins])

  const stats = useMemo(() => {
    const total = vins.reduce((s, v) => s + (v.quantite || 0), 0)
    const valeur = vins.reduce((s, v) => s + (v.quantite || 0) * (v.prix_unitaire || 0), 0)
    const refs = vins.length
    const noted = degustations.filter(d => d.appreciation)
    const noteMoy = noted.length ? (noted.reduce((s, d) => s + d.appreciation, 0) / noted.length).toFixed(1) : '—'
    const aBoire = vinsAvecStatut.reduce((s, v) => s + ((v.statut === "À boire d'urgence" || v.statut === 'À boire bientôt') ? (v.quantite || 0) : 0), 0)
    const parCouleur = COULEURS.map(c => ({ couleur: c, count: vins.filter(v => v.couleur === c).reduce((s, v) => s + (v.quantite || 0), 0) })).filter(x => x.count > 0)
    const parPays = {}
    vins.forEach(v => { if (v.pays) parPays[v.pays] = (parPays[v.pays] || 0) + (v.quantite || 0) })
    const valeurParPays = {}
    vins.forEach(v => { if (v.pays) valeurParPays[v.pays] = (valeurParPays[v.pays] || 0) + (v.quantite || 0) * (v.prix_unitaire || 0) })
    const parCepage = {}
    vins.forEach(v => { if (v.cepage) parCepage[v.cepage] = (parCepage[v.cepage] || 0) + (v.quantite || 0) })
    return { total, valeur, refs, noteMoy, aBoire, parCouleur, parPays, valeurParPays, parCepage }
  }, [vins, degustations, vinsAvecStatut])

  // ── Filtrage inventaire ────────────────────────────────────────────
  const vinsFiltres = useMemo(() => vinsAvecStatut
    .filter(v => filtreCouleur === 'Tous' || v.couleur === filtreCouleur)
    .filter(v => filtreStatut === 'Tous' || v.statut === filtreStatut)
    .filter(v => !recherche || [v.nom, v.appellation, v.region, v.producteur, v.vendeur, v.cepage].some(f => f?.toLowerCase().includes(recherche.toLowerCase())))
    .sort((a, b) =>
      triPar === 'nom' ? (a.nom || '').localeCompare(b.nom || '') :
      triPar === 'note' ? (b.note_perso || 0) - (a.note_perso || 0) :
      triPar === 'millesime' ? (b.millesime || 0) - (a.millesime || 0) :
      triPar === 'statut' ? (a.statut || '').localeCompare(b.statut || '') :
      (b.prix_unitaire || 0) - (a.prix_unitaire || 0)
    ), [vinsAvecStatut, filtreCouleur, filtreStatut, recherche, triPar])

  // ── Photo upload (resize) ─────────────────────────────────────────
  const handlePhoto = (e, isForm = false) => {
    const file = e.target.files[0]
    if (!file) return
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const max = 800
      const ratio = Math.min(max / img.width, max / img.height, 1)
      canvas.width = img.width * ratio
      canvas.height = img.height * ratio
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', 0.82)
      URL.revokeObjectURL(url)
      if (isForm) setFormData(p => ({ ...p, photo: data }))
      else if (vinSelectionne) updateVin(vinSelectionne.id, { photo: data })
    }
    img.src = url
  }

  // ── CRUD vins ──────────────────────────────────────────────────────
  const enregistrerVin = async () => {
    setSaving(true)
    const payload = {
      ...formData,
      millesime: formData.millesime ? +formData.millesime : null,
      quantite: +formData.quantite || 1,
      prix_unitaire: formData.prix_unitaire ? +formData.prix_unitaire : null,
      date_apogee: formData.date_apogee ? +formData.date_apogee : null,
      note_perso: formData.note_perso ? +formData.note_perso : null,
      accords: formData.accords ? formData.accords.split(',').map(s => s.trim()).filter(Boolean) : [],
      date_achat: formData.date_achat || null,
      emplacement: formData.emplacement || null,
      id_bouteille: formData.id_bouteille || null,
    }
    delete payload.id

    if (editingId) {
      // ── Mode édition ──
      const { data, error } = await supabase.from('vins').update(payload).eq('id', editingId).select().single()
      if (error) { showToast('Erreur lors de la modification : ' + error.message, 'err'); setSaving(false); return }
      await sauvegarderReferentielSiNouveau(data.pays, data.region, data.appellation, data.cepage)
      await loadAll()
      setVinSelectionne(data)
      showToast('Vin modifié ✓')
      setShowForm(false)
      setEditingId(null)
      setFormData(EMPTY_FORM)
      setSaving(false)
      return
    }

    // ── Mode ajout ──
    payload.cotations = null
    const { data, error } = await supabase.from('vins').insert(payload).select().single()
    if (error) { showToast("Erreur lors de l'ajout : " + error.message, 'err'); setSaving(false); return }

    // Créer un mouvement d'entrée automatique
    if (data.quantite > 0) {
      await supabase.from('mouvements').insert({
        date: data.date_achat || new Date().toISOString().slice(0, 10),
        vin_id: data.id, type_mouvement: 'Entrée', quantite: data.quantite,
        emplacement_cible: data.emplacement, motif: 'Achat initial', commentaire: data.vendeur
      })
    }
    // Sauvegarder la combinaison Pays/Région/Appellation/Cépage si nouvelle
    await sauvegarderReferentielSiNouveau(data.pays, data.region, data.appellation, data.cepage)

    await loadAll()
    showToast('Vin ajouté ✓')
    setShowForm(false)
    setFormData(EMPTY_FORM)
    setSaving(false)
  }

  // ── Ouvrir le formulaire en mode édition ────────────────────────────
  const ouvrirEdition = (vin) => {
    setFormData({
      id_bouteille: vin.id_bouteille || '', nom: vin.nom || '', producteur: vin.producteur || '',
      millesime: vin.millesime ?? '', couleur: vin.couleur || 'Rouge', format: vin.format || 'Bouteille (75cl)',
      pays: vin.pays || 'France', region: vin.region || '', appellation: vin.appellation || '', cepage: vin.cepage || '',
      quantite: vin.quantite ?? 1, emplacement: vin.emplacement || '',
      date_achat: vin.date_achat || '', vendeur: vin.vendeur || '', prix_unitaire: vin.prix_unitaire ?? '',
      date_apogee: vin.date_apogee ?? '', fenetre_consommation: vin.fenetre_consommation || '', notes: vin.notes || '',
      commentaire_degustation: vin.commentaire_degustation || '', note_perso: vin.note_perso ?? '',
      accords: (vin.accords || []).join(', '), photo: vin.photo || null
    })
    setEditingId(vin.id)
    setVinSelectionne(null)
    setShowForm(true)
  }

  const updateVin = async (id, changes) => {
    const { data, error } = await supabase.from('vins').update(changes).eq('id', id).select().single()
    if (error) { showToast('Erreur de mise à jour', 'err'); return }
    setVins(p => p.map(v => v.id === id ? data : v))
    if (vinSelectionne?.id === id) setVinSelectionne(data)
    showToast('Sauvegardé ✓')
  }

  const supprimerVin = async (id) => {
    const { error } = await supabase.from('vins').delete().eq('id', id)
    if (error) { showToast('Erreur de suppression', 'err'); return }
    setVins(p => p.filter(v => v.id !== id))
    setVinSelectionne(null)
    showToast('Vin supprimé')
  }

  // ── Mouvement rapide (sortie / consommation) ─────────────────────
  const enregistrerSortie = async (vin, quantite, motif) => {
    if (quantite > vin.quantite) { showToast('Quantité supérieure au stock', 'err'); return }
    await supabase.from('mouvements').insert({
      date: new Date().toISOString().slice(0, 10), vin_id: vin.id, type_mouvement: 'Sortie',
      quantite, emplacement_source: vin.emplacement, motif
    })
    await updateVin(vin.id, { quantite: vin.quantite - quantite })
    await loadAll()
  }

  // ── Dégustation ────────────────────────────────────────────────────
  const ajouterDegustation = async () => {
    if (!vinSelectionne) return
    const { error } = await supabase.from('degustations').insert({
      date_degustation: new Date().toISOString().slice(0, 10),
      vin_id: vinSelectionne.id,
      appreciation: +degustForm.appreciation,
      invites: degustForm.invites,
      commentaires: degustForm.commentaires,
      moment_consommation: degustForm.moment_consommation,
      service_temperature: degustForm.service_temperature,
    })
    if (error) { showToast('Erreur', 'err'); return }
    await loadAll()
    setShowDegustForm(false)
    setDegustForm({ appreciation: 5, invites: '', commentaires: '', moment_consommation: '', service_temperature: '' })
    showToast('Dégustation enregistrée ✓')
  }

  // ── Scanner une étiquette via IA (vision) ──────────────────────────
  const scannerEtiquette = async () => {
    if (!formData.photo) { showToast('Ajoutez une photo de l\'étiquette d\'abord', 'err'); return }
    setScanning(true)
    try {
      const base64 = formData.photo.split(',')[1]
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 600,
          system: 'Tu es un expert en vins capable de lire des étiquettes. Analyse la photo et extrait les informations visibles. Réponds UNIQUEMENT en JSON valide sans backticks, avec ces clés (mets null si non identifiable) : {"nom":"<nom du vin/cuvée>","producteur":"<nom du producteur/domaine/château>","millesime":<année ou null>,"couleur":"<Rouge|Blanc|Rosé|Effervescent|Liquoreux ou null>","pays":"<pays d\'origine ou null>","region":"<région viticole ou null>","appellation":"<appellation ou null>","cepage":"<cépage principal ou null>"}',
          messages: [{
            role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: "Identifie ce vin à partir de son étiquette et remplis le JSON demandé." }
            ]
          }]
        })
      })
      const data = await response.json()
      const text = data.content?.filter(i => i.type === 'text').map(i => i.text).join('') || ''
      const r = JSON.parse(text.replace(/```json|```/g, '').trim())
      setFormData(p => ({
        ...p,
        nom: r.nom || p.nom,
        producteur: r.producteur || p.producteur,
        millesime: r.millesime || p.millesime,
        couleur: COULEURS.includes(r.couleur) ? r.couleur : p.couleur,
        pays: r.pays || p.pays,
        region: r.region || p.region,
        appellation: r.appellation || p.appellation,
        cepage: r.cepage || p.cepage,
      }))
      showToast('Étiquette analysée ✓ — vérifiez les champs')
    } catch { showToast("Impossible d'analyser l'étiquette", 'err') }
    setScanning(false)
  }

  // ── Cotations IA ───────────────────────────────────────────────────
  const chercherCotations = async (vin) => {
    setLoadingCotations(true)
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 800,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: 'Tu es un expert en vins. Cherche les cotations du vin demandé. Réponds UNIQUEMENT en JSON valide sans backticks : {"jamesSuckling":<number|null>,"robertParker":<number|null>,"revueVinFrance":<number|null>,"source":"<note courte>"}',
          messages: [{ role: 'user', content: `Cotations pour : ${vin.nom}, millésime ${vin.millesime || 'NM'}, ${vin.appellation || ''}` }]
        })
      })
      const data = await response.json()
      const text = data.content?.filter(i => i.type === 'text').map(i => i.text).join('') || ''
      const cotations = JSON.parse(text.replace(/```json|```/g, '').trim())
      await updateVin(vin.id, { cotations })
    } catch { showToast('Cotations introuvables', 'err') }
    setLoadingCotations(false)
  }

  // ── Accords IA ─────────────────────────────────────────────────────
  const chercherAccords = async () => {
    if (!repasQuery.trim()) return
    setLoadingIA(true); setSuggestions(null)
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 600,
          system: `Tu es sommelier. Cave disponible : ${JSON.stringify(vins.filter(v => v.quantite > 0).map(v => ({ id: v.id, nom: v.nom, couleur: v.couleur, millesime: v.millesime, note: v.note_perso })))}. Réponds UNIQUEMENT en JSON sans backticks : {"suggestions":[{"id":"<uuid>","raison":"<20 mots>"}],"conseil":"<1 phrase>"}`,
          messages: [{ role: 'user', content: repasQuery }]
        })
      })
      const data = await response.json()
      const text = data.content?.map(i => i.text || '').join('') || ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      const enrichi = parsed.suggestions.map(s => ({ ...vins.find(v => v.id === s.id), raison: s.raison })).filter(Boolean)
      setSuggestions({ vins: enrichi, conseil: parsed.conseil })
    } catch { showToast('Erreur du sommelier IA', 'err') }
    setLoadingIA(false)
  }

  // ── Styles ─────────────────────────────────────────────────────────
  const S = {
    app: { minHeight: '100vh', background: '#FAFAFA', color: '#111', fontFamily: "'DM Sans', sans-serif", paddingBottom: 40 },
    header: { background: '#fff', borderBottom: '1px solid #EBEBEB', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, position: 'sticky', top: 0, zIndex: 50, overflowX: 'auto' },
    logoText: { fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 700, color: '#111', whiteSpace: 'nowrap' },
    nav: { display: 'flex', gap: 2, overflowX: 'auto' },
    navBtn: (a) => ({ background: a ? '#111' : 'transparent', color: a ? '#fff' : '#888', border: 'none', borderRadius: 6, padding: '7px 13px', cursor: 'pointer', fontSize: 12, fontWeight: 500, transition: 'all .18s', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }),
    content: { padding: '20px 20px', maxWidth: 1240, margin: '0 auto' },
    statGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 },
    statCard: { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '18px 20px' },
    statVal: { fontFamily: "'Playfair Display', serif", fontSize: 24, fontWeight: 700, lineHeight: 1, marginBottom: 4 },
    statLabel: { fontSize: 10.5, color: '#AAA', letterSpacing: 1.2, textTransform: 'uppercase' },
    filterBar: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' },
    input: { background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, padding: '9px 14px', color: '#111', fontSize: 14, outline: 'none', flex: 1, minWidth: 160 },
    select: { background: '#fff', border: '1px solid #E0E0E0', borderRadius: 8, padding: '9px 14px', color: '#111', fontSize: 13, outline: 'none', cursor: 'pointer' },
    btnPrimary: { background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 },
    btnOutline: { background: '#fff', color: '#111', border: '1px solid #E0E0E0', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
    btnDanger: { background: '#fff', color: '#C04040', border: '1px solid #EACACA', borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontFamily: "'DM Sans', sans-serif" },
    card: { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' },
    th: { textAlign: 'left', padding: '10px 14px', color: '#BBB', fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', borderBottom: '1px solid #F0F0F0', background: '#FAFAFA', fontWeight: 500 },
    td: { padding: '12px 14px', borderBottom: '1px solid #F4F4F4', fontSize: 13.5, verticalAlign: 'middle' },
    modal: { position: 'fixed', inset: 0, background: '#00000050', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(3px)' },
    modalBox: { background: '#fff', border: '1px solid #EBEBEB', borderRadius: 16, padding: 30, maxWidth: 680, width: '100%', maxHeight: '92vh', overflowY: 'auto', position: 'relative', boxShadow: '0 24px 64px #00000018' },
    closeBtn: { position: 'absolute', top: 14, right: 18, background: 'none', border: 'none', color: '#CCC', fontSize: 22, cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit' },
    sectionTitle: { fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 500, marginBottom: 16, color: '#111' },
    formLabel: { fontSize: 10.5, color: '#AAA', letterSpacing: 1.2, textTransform: 'uppercase', display: 'block', marginBottom: 5 },
    formInput: { background: '#F8F8F8', border: '1px solid #E8E8E8', borderRadius: 8, padding: '9px 12px', color: '#111', fontSize: 13.5, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: "'DM Sans', sans-serif" },
    tag: { background: '#F2F2F2', color: '#555', borderRadius: 20, padding: '4px 12px', fontSize: 12, display: 'inline-block', margin: '3px 3px 3px 0' },
    dot: (c) => ({ width: 7, height: 7, borderRadius: '50%', background: COULEUR_DOT[c] || '#CCC', display: 'inline-block', marginRight: 6 }),
    photoBox: { background: '#F8F8F8', border: '1px dashed #DDD', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' },
  }

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=DM+Sans:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #FAFAFA; }
        input, select, textarea { font-family: 'DM Sans', sans-serif; }
        input::placeholder { color: #CCC; }
        tr:hover td { background: #FAFAFA; }
        ::-webkit-scrollbar { width: 4px; height: 4px; background: #F0F0F0; }
        ::-webkit-scrollbar-thumb { background: #DDD; border-radius: 2px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 760px) {
          .stat-grid { grid-template-columns: 1fr 1fr !important; }
          .hide-mobile { display: none !important; }
          .content { padding: 14px !important; }
          .filter-bar { flex-direction: column; align-items: stretch !important; }
          .modal-box { padding: 18px !important; }
          .two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* HEADER */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>🍷</span>
          <span style={S.logoText}>Ma Cave</span>
        </div>
        <nav style={S.nav}>
          {[['inventaire','Inventaire'],['statistiques','Stats'],['emplacements','Cave'],['mouvements','Mouvements'],['degustations','Dégustations'],['accords','Accords']].map(([id, label]) => (
            <button key={id} style={S.navBtn(onglet === id)} onClick={() => setOnglet(id)}>{label}</button>
          ))}
        </nav>
        <div style={{ fontSize: 12, color: '#AAA', textAlign: 'right' }} className="hide-mobile">
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: '#111', fontWeight: 500 }}>{stats.total}</span> btl
          &nbsp;·&nbsp;
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, color: '#111', fontWeight: 500 }}>{fmt(stats.valeur)}</span>
        </div>
      </header>

      <div style={S.content} className="content">

        {/* ══ INVENTAIRE ══════════════════════════════════════════════ */}
        {onglet === 'inventaire' && (
          <>
            <div style={S.filterBar} className="filter-bar">
              <input style={S.input} placeholder="Rechercher (nom, appellation, cépage, producteur…)" value={recherche} onChange={e => setRecherche(e.target.value)} />
              <select style={S.select} value={filtreCouleur} onChange={e => setFiltreCouleur(e.target.value)}>
                <option>Tous</option>
                {COULEURS.map(c => <option key={c}>{c}</option>)}
              </select>
              <select style={S.select} value={filtreStatut} onChange={e => setFiltreStatut(e.target.value)}>
                <option value="Tous">Tous statuts</option>
                {Object.keys(STATUT_COLOR).map(s => <option key={s}>{s}</option>)}
              </select>
              <select style={S.select} value={triPar} onChange={e => setTriPar(e.target.value)}>
                <option value="nom">Nom</option>
                <option value="note">Note perso</option>
                <option value="millesime">Millésime</option>
                <option value="statut">Statut</option>
                <option value="prix">Prix</option>
              </select>
              <button style={S.btnPrimary} onClick={() => { setFormData(EMPTY_FORM); setEditingId(null); setShowForm(true) }}>+ Ajouter</button>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#CCC' }}><Spinner /> <span style={{ marginLeft: 10 }}>Chargement…</span></div>
            ) : (
              <div style={S.card}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                    <thead>
                      <tr>
                        {['', 'Vin', 'Origine', 'Couleur', 'Millésime', 'Qté', 'Emplacement', 'Prix', 'Statut', ''].map((h, i) => <th key={i} style={S.th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {vinsFiltres.map(v => (
                        <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setVinSelectionne(v)}>
                          <td style={{ ...S.td, width: 40, padding: '8px 6px 8px 12px' }}>
                            {v.photo
                              ? <img src={v.photo} alt="" style={{ width: 28, height: 38, objectFit: 'cover', borderRadius: 4, border: '1px solid #EEE' }} />
                              : <div style={{ width: 28, height: 38, background: '#F4F4F4', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#DDD' }}>🍾</div>}
                          </td>
                          <td style={S.td}>
                            <div style={{ fontWeight: 500 }}>{v.nom}{v.id_bouteille && <span style={{ color: '#CCC', fontWeight: 400, fontSize: 11 }}> · {v.id_bouteille}</span>}</div>
                            <div style={{ fontSize: 11.5, color: '#BBB', marginTop: 2 }}>{v.producteur}</div>
                          </td>
                          <td style={{ ...S.td, color: '#777', fontSize: 12.5 }}>{[v.appellation, v.region, v.pays].filter(Boolean).join(' · ')}</td>
                          <td style={S.td}><span style={S.dot(v.couleur)} /><span style={{ fontSize: 12.5, color: '#666' }}>{v.couleur}</span></td>
                          <td style={{ ...S.td, fontWeight: 500 }}>{v.millesime || '—'}</td>
                          <td style={{ ...S.td, color: v.quantite < 3 ? '#C04040' : '#111', fontWeight: 500 }}>{v.quantite}</td>
                          <td style={{ ...S.td, color: '#999', fontSize: 12.5 }}>{v.emplacement || '—'}</td>
                          <td style={{ ...S.td, color: '#777' }}>{fmt(v.prix_unitaire)}</td>
                          <td style={S.td}><StatutPill statut={v.statut} /></td>
                          <td style={{ ...S.td, color: '#DDD' }}>›</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 12, color: '#CCC' }}>{vinsFiltres.length} résultat{vinsFiltres.length !== 1 ? 's' : ''}</div>
          </>
        )}

        {/* ══ STATISTIQUES ════════════════════════════════════════════ */}
        {onglet === 'statistiques' && (
          <>
            <div style={S.statGrid} className="stat-grid">
              {[[stats.total || 0, 'Bouteilles'], [fmt(stats.valeur), 'Valeur'], [stats.refs, 'Références'], [stats.noteMoy + (stats.noteMoy !== '—' ? '/5' : ''), 'Note dégust. moy.'], [stats.aBoire, 'À boire <12 mois']].map(([v, l]) => (
                <div key={l} style={S.statCard}><div style={S.statVal}>{v}</div><div style={S.statLabel}>{l}</div></div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }} className="two-col">
              <div style={S.card}>
                <div style={{ padding: '20px 22px' }}>
                  <div style={S.sectionTitle}>Répartition par couleur</div>
                  {stats.parCouleur.map(({ couleur, count }) => (
                    <div key={couleur} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13.5 }}>
                        <span><span style={S.dot(couleur)} />{couleur}</span>
                        <span style={{ color: '#AAA' }}>{count} · {Math.round(count / stats.total * 100)}%</span>
                      </div>
                      <div style={{ background: '#F4F4F4', borderRadius: 3, height: 4 }}>
                        <div style={{ height: 4, background: COULEUR_DOT[couleur] || '#111', borderRadius: 3, width: `${count / stats.total * 100}%`, transition: 'width .5s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={S.card}>
                <div style={{ padding: '20px 22px' }}>
                  <div style={S.sectionTitle}>Stock & valeur par pays</div>
                  {Object.entries(stats.parPays).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pays, count]) => (
                    <div key={pays} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F4F4F4', fontSize: 13.5 }}>
                      <span>{pays}</span>
                      <span style={{ color: '#999' }}>{count} btl · {fmt(stats.valeurParPays[pays])}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={S.card}>
              <div style={{ padding: '20px 22px' }}>
                <div style={S.sectionTitle}>Top cépages (par volume)</div>
                {Object.entries(stats.parCepage).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cepage, count]) => (
                  <div key={cepage} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span>{cepage}</span><span style={{ color: '#AAA' }}>{count} btl</span>
                    </div>
                    <div style={{ background: '#F4F4F4', borderRadius: 3, height: 4 }}>
                      <div style={{ height: 4, background: '#111', borderRadius: 3, width: `${count / Math.max(...Object.values(stats.parCepage)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ══ EMPLACEMENTS ════════════════════════════════════════════ */}
        {onglet === 'emplacements' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {emplacements.map(e => {
              const occupe = vins.filter(v => v.emplacement === e.code).reduce((s, v) => s + (v.quantite || 0), 0)
              return (
                <div key={e.code} style={{ ...S.card, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 600 }}>{e.code}</div>
                      <div style={{ fontSize: 12.5, color: '#999', marginTop: 2 }}>{e.zone}{e.rayon ? ` · ${e.rayon}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{occupe}<span style={{ color: '#CCC', fontSize: 12, fontWeight: 400 }}>/{e.capacite || '—'}</span></div>
                      <div style={{ fontSize: 10, color: '#CCC', letterSpacing: 1, textTransform: 'uppercase' }}>occupé</div>
                    </div>
                  </div>
                  {e.capacite && (
                    <div style={{ background: '#F4F4F4', borderRadius: 3, height: 4, marginBottom: 12 }}>
                      <div style={{ height: 4, background: occupe > e.capacite ? '#C04040' : '#111', borderRadius: 3, width: `${Math.min(100, occupe / e.capacite * 100)}%` }} />
                    </div>
                  )}
                  <div style={{ fontSize: 12.5, color: '#999', display: 'flex', gap: 14 }}>
                    {e.temperature_cible && <span>🌡 {e.temperature_cible}°C</span>}
                    {e.humidite_cible && <span>💧 {e.humidite_cible}%</span>}
                  </div>
                  {e.notes && <div style={{ fontSize: 12, color: '#BBB', marginTop: 8, fontStyle: 'italic' }}>{e.notes}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* ══ MOUVEMENTS ══════════════════════════════════════════════ */}
        {onglet === 'mouvements' && (
          <div style={S.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead><tr>{['Date', 'Vin', 'Type', 'Qté', 'Source', 'Cible', 'Motif', 'Commentaire'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {mouvements.map(m => (
                    <tr key={m.id}>
                      <td style={{ ...S.td, color: '#999' }}>{m.date}</td>
                      <td style={S.td}><b>{m.vins?.nom}</b> {m.vins?.millesime}</td>
                      <td style={S.td}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: m.type_mouvement === 'Entrée' ? '#1A7A3A18' : m.type_mouvement === 'Sortie' ? '#C0404018' : '#88888818', color: m.type_mouvement === 'Entrée' ? '#1A7A3A' : m.type_mouvement === 'Sortie' ? '#C04040' : '#888' }}>{m.type_mouvement}</span>
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{m.quantite}</td>
                      <td style={{ ...S.td, color: '#999' }}>{m.emplacement_source || '—'}</td>
                      <td style={{ ...S.td, color: '#999' }}>{m.emplacement_cible || '—'}</td>
                      <td style={{ ...S.td, color: '#777' }}>{m.motif || '—'}</td>
                      <td style={{ ...S.td, color: '#AAA', fontSize: 12.5 }}>{m.commentaire || '—'}</td>
                    </tr>
                  ))}
                  {mouvements.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#CCC', padding: 30 }}>Aucun mouvement enregistré</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ DÉGUSTATIONS ════════════════════════════════════════════ */}
        {onglet === 'degustations' && (
          <div style={{ display: 'grid', gap: 10 }}>
            {degustations.map(d => (
              <div key={d.id} style={{ ...S.card, padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 22, minWidth: 70 }}>{'★'.repeat(d.appreciation || 0)}<span style={{ color: '#EEE' }}>{'★'.repeat(5 - (d.appreciation || 0))}</span></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{d.vins?.nom} {d.vins?.millesime}</div>
                  <div style={{ fontSize: 12, color: '#AAA', margin: '3px 0 8px' }}>{d.date_degustation}{d.moment_consommation ? ` · ${d.moment_consommation}` : ''}{d.invites ? ` · Avec ${d.invites}` : ''}</div>
                  {d.commentaires && <div style={{ fontSize: 13.5, color: '#666', fontStyle: 'italic' }}>« {d.commentaires} »</div>}
                  {d.service_temperature && <div style={{ fontSize: 12, color: '#BBB', marginTop: 6 }}>🌡 {d.service_temperature}</div>}
                </div>
              </div>
            ))}
            {degustations.length === 0 && <div style={{ ...S.card, padding: 30, textAlign: 'center', color: '#CCC' }}>Aucune dégustation enregistrée</div>}
          </div>
        )}

        {/* ══ ACCORDS ═════════════════════════════════════════════════ */}
        {onglet === 'accords' && (
          <>
            <div style={{ ...S.card, padding: 22, marginBottom: 18 }}>
              <div style={S.sectionTitle}>Sommelier IA</div>
              <p style={{ color: '#AAA', fontSize: 13.5, marginBottom: 16, lineHeight: 1.7 }}>Décrivez votre plat pour trouver le vin idéal dans votre cave.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input style={{ ...S.input, fontSize: 14, padding: '11px 15px' }} placeholder="Magret de canard, homard, côte de bœuf…" value={repasQuery} onChange={e => setRepasQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && chercherAccords()} />
                <button style={{ ...S.btnPrimary, padding: '11px 20px' }} onClick={chercherAccords} disabled={loadingIA}>{loadingIA ? <Spinner /> : 'Consulter'}</button>
              </div>
            </div>
            {suggestions?.vins?.length > 0 && (
              <>
                {suggestions.conseil && <div style={{ background: '#F8F8F8', borderRadius: 10, padding: '12px 16px', marginBottom: 14, color: '#666', fontSize: 13.5, fontStyle: 'italic' }}>💡 {suggestions.conseil}</div>}
                {suggestions.vins.map((v, i) => (
                  <div key={v.id} style={{ ...S.card, padding: 18, marginBottom: 10, display: 'flex', gap: 14, alignItems: 'flex-start', animation: 'fadeIn .3s ease' }}>
                    <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: ['#C9A84C', '#999', '#CD7F32'][i] || '#CCC', minWidth: 30 }}>#{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{v.nom} {v.millesime && <span style={{ color: '#AAA', fontWeight: 400 }}>{v.millesime}</span>}</div>
                      <div style={{ fontSize: 12, color: '#BBB', margin: '4px 0 6px' }}><span style={S.dot(v.couleur)} />{v.couleur}</div>
                      <div style={{ fontSize: 13, color: '#777', fontStyle: 'italic' }}>« {v.raison} »</div>
                    </div>
                    {v.note_perso && <div style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>{v.note_perso}</div>}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* ══ MODAL DÉTAIL VIN ════════════════════════════════════════ */}
      {vinSelectionne && (
        <div style={S.modal} onClick={() => setVinSelectionne(null)}>
          <div style={S.modalBox} className="modal-box" onClick={e => e.stopPropagation()}>
            <button style={S.closeBtn} onClick={() => setVinSelectionne(null)}>×</button>
            <div style={{ display: 'flex', gap: 18, marginBottom: 22, flexWrap: 'wrap' }}>
              <div>
                <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={e => handlePhoto(e)} />
                <div style={{ ...S.photoBox, width: 88, height: 122, flexShrink: 0 }} onClick={() => fileRef.current.click()}>
                  {vinSelectionne.photo
                    ? <img src={vinSelectionne.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ textAlign: 'center', color: '#CCC', fontSize: 11, padding: 8 }}><div style={{ fontSize: 20, marginBottom: 4 }}>📷</div>Photo</div>}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 21, fontWeight: 500, lineHeight: 1.2, marginBottom: 4 }}>{vinSelectionne.nom}</div>
                <div style={{ color: '#AAA', fontSize: 12.5, marginBottom: 8 }}>{vinSelectionne.producteur}{vinSelectionne.id_bouteille ? ` · ${vinSelectionne.id_bouteille}` : ''}</div>
                <div style={{ color: '#999', fontSize: 12.5, marginBottom: 12 }}>{[vinSelectionne.appellation, vinSelectionne.cepage, vinSelectionne.region, vinSelectionne.pays].filter(Boolean).join(' · ')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[[calculerStatut(vinSelectionne), 'Statut', true], [vinSelectionne.millesime || 'NM', 'Millésime'], [vinSelectionne.quantite + ' btl', 'Stock'], [fmt(vinSelectionne.prix_unitaire), 'Prix unitaire'], [vinSelectionne.emplacement || '—', 'Emplacement']].map(([v, l, isStatut]) => (
                    <div key={l} style={{ background: '#F8F8F8', borderRadius: 8, padding: '8px 12px', minWidth: 68 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: isStatut ? (STATUT_COLOR[v] || '#111') : '#111' }}>{v}</div>
                      <div style={{ fontSize: 10, color: '#BBB', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Achat */}
            <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Informations d'achat</div>
              <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#666', flexWrap: 'wrap' }}>
                <span>Acheté le <b>{vinSelectionne.date_achat || '—'}</b></span>
                <span>Chez <b>{vinSelectionne.vendeur || '—'}</b></span>
                <span>Apogée <b>{vinSelectionne.date_apogee || '—'}</b></span>
                <span>Garde <b>{vinSelectionne.fenetre_consommation || '—'}</b></span>
              </div>
            </div>

            {/* Actions rapides : sortie */}
            <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={S.btnOutline} disabled={!vinSelectionne.quantite} onClick={() => enregistrerSortie(vinSelectionne, 1, 'Consommation')}>🍷 Boire une bouteille (-1)</button>
              <button style={S.btnOutline} onClick={() => setShowDegustForm(true)}>✍️ Ajouter une dégustation</button>
              <button style={S.btnOutline} onClick={() => ouvrirEdition(vinSelectionne)}>✏️ Modifier</button>
            </div>

            {/* Cotations */}
            <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Cotations des critiques</div>
                <button style={S.btnOutline} onClick={() => chercherCotations(vinSelectionne)} disabled={loadingCotations}>
                  {loadingCotations ? <><Spinner /> Recherche…</> : vinSelectionne.cotations ? '↺ Actualiser' : '🔍 Rechercher'}
                </button>
              </div>
              {vinSelectionne.cotations ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                    <ScoreBadge label="James Suckling" score={vinSelectionne.cotations.jamesSuckling} />
                    <ScoreBadge label="Robert Parker" score={vinSelectionne.cotations.robertParker} />
                    <ScoreBadge label="RVF" score={vinSelectionne.cotations.revueVinFrance} />
                  </div>
                  {vinSelectionne.cotations.source && <div style={{ fontSize: 12, color: '#CCC', fontStyle: 'italic', marginTop: 10 }}>{vinSelectionne.cotations.source}</div>}
                </>
              ) : <div style={{ background: '#F8F8F8', borderRadius: 8, padding: 12, fontSize: 12.5, color: '#CCC', textAlign: 'center' }}>Cliquez sur "Rechercher" pour obtenir les cotations</div>}
            </div>

            {vinSelectionne.commentaire_degustation && (
              <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>Note personnelle</div>
                <p style={{ fontSize: 13.5, color: '#666', lineHeight: 1.7, fontStyle: 'italic' }}>{vinSelectionne.commentaire_degustation}</p>
                {vinSelectionne.note_perso && <div style={{ marginTop: 8, fontWeight: 600 }}>{vinSelectionne.note_perso}<span style={{ color: '#CCC', fontWeight: 400 }}>/100</span></div>}
              </div>
            )}

            {vinSelectionne.accords?.length > 0 && (
              <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>Accords mets-vins</div>
                {vinSelectionne.accords.map(a => <span key={a} style={S.tag}>{a}</span>)}
              </div>
            )}

            {vinSelectionne.notes && (
              <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>Notes</div>
                <p style={{ fontSize: 13.5, color: '#888' }}>{vinSelectionne.notes}</p>
              </div>
            )}

            <div style={{ borderTop: '1px solid #F0F0F0', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button style={S.btnDanger} onClick={() => supprimerVin(vinSelectionne.id)}>Supprimer ce vin</button>
            </div>

            {/* Sous-modal dégustation */}
            {showDegustForm && (
              <div style={{ ...S.modal, position: 'absolute', borderRadius: 16 }} onClick={() => setShowDegustForm(false)}>
                <div style={{ ...S.modalBox, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
                  <button style={S.closeBtn} onClick={() => setShowDegustForm(false)}>×</button>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, marginBottom: 18 }}>Ajouter une dégustation</div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.formLabel}>Appréciation (1-5)</label>
                    <select style={{ ...S.formInput, cursor: 'pointer' }} value={degustForm.appreciation} onChange={e => setDegustForm(p => ({ ...p, appreciation: e.target.value }))}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.formLabel}>Invités</label>
                    <input style={S.formInput} value={degustForm.invites} onChange={e => setDegustForm(p => ({ ...p, invites: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.formLabel}>Moment de consommation</label>
                    <input style={S.formInput} placeholder="Dîner, apéritif…" value={degustForm.moment_consommation} onChange={e => setDegustForm(p => ({ ...p, moment_consommation: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={S.formLabel}>Service / température</label>
                    <input style={S.formInput} placeholder="17°C, carafé 2h…" value={degustForm.service_temperature} onChange={e => setDegustForm(p => ({ ...p, service_temperature: e.target.value }))} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={S.formLabel}>Commentaires</label>
                    <textarea style={{ ...S.formInput, minHeight: 70, resize: 'vertical' }} value={degustForm.commentaires} onChange={e => setDegustForm(p => ({ ...p, commentaires: e.target.value }))} />
                  </div>
                  <button style={{ ...S.btnPrimary, width: '100%', justifyContent: 'center', padding: 12 }} onClick={ajouterDegustation}>Enregistrer</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ MODAL AJOUT VIN ═════════════════════════════════════════ */}
      {showForm && (
        <div style={S.modal} onClick={() => { setShowForm(false); setEditingId(null) }}>
          <div style={S.modalBox} className="modal-box" onClick={e => e.stopPropagation()}>
            <button style={S.closeBtn} onClick={() => { setShowForm(false); setEditingId(null) }}>×</button>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 19, marginBottom: 4 }}>{editingId ? '✏️ Modifier le vin' : "🍷 Ajout d'une bouteille"}</div>
            <div style={{ fontSize: 12, color: '#CCC', marginBottom: 18 }}>Les champs Pays / Région / Appellation / Cépage sont liés en cascade.</div>

            {/* Identification */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>📋 Identification</div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <div>
                <input type="file" accept="image/*" ref={formFileRef} style={{ display: 'none' }} onChange={e => handlePhoto(e, true)} />
                <div style={{ ...S.photoBox, width: 76, height: 104, cursor: 'pointer' }} onClick={() => formFileRef.current.click()}>
                  {formData.photo
                    ? <img src={formData.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ textAlign: 'center', color: '#CCC', fontSize: 10.5, padding: 6 }}><div style={{ fontSize: 18, marginBottom: 4 }}>📷</div>Étiquette</div>}
                </div>
                {formData.photo && (
                  <button type="button" style={{ ...S.btnOutline, marginTop: 6, width: 76, justifyContent: 'center', padding: '6px 4px', fontSize: 11 }} onClick={scannerEtiquette} disabled={scanning}>
                    {scanning ? <Spinner /> : '🔍 Scanner'}
                  </button>
                )}
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div><label style={S.formLabel}>ID bouteille</label><input style={S.formInput} placeholder="B001" value={formData.id_bouteille} onChange={e => setFormData(p => ({ ...p, id_bouteille: e.target.value }))} /></div>
                <div><label style={S.formLabel}>Nom du vin *</label><input style={S.formInput} value={formData.nom} onChange={e => setFormData(p => ({ ...p, nom: e.target.value }))} /></div>
                <div><label style={S.formLabel}>Producteur</label><input style={S.formInput} value={formData.producteur} onChange={e => setFormData(p => ({ ...p, producteur: e.target.value }))} /></div>
                <div><label style={S.formLabel}>Millésime</label><input type="number" style={S.formInput} value={formData.millesime} onChange={e => setFormData(p => ({ ...p, millesime: e.target.value }))} /></div>
                <div>
                  <label style={S.formLabel}>Couleur</label>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.couleur} onChange={e => setFormData(p => ({ ...p, couleur: e.target.value }))}>
                    {COULEURS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.formLabel}>Format</label>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.format} onChange={e => setFormData(p => ({ ...p, format: e.target.value }))}>
                    {FORMATS.map(f => <option key={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Origine - cascade */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>🌍 Origine</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div>
                <label style={S.formLabel}>Pays d'origine</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.pays} onChange={e => setFormData(p => ({ ...p, pays: e.target.value, region: '', appellation: '', cepage: '' }))}>
                    {PAYS_LIST_COMPLET.map(p => <option key={p}>{p}</option>)}
                    {formData.pays && !PAYS_LIST_COMPLET.includes(formData.pays) && <option key={formData.pays}>{formData.pays}</option>}
                  </select>
                  <button type="button" style={{ ...S.btnOutline, padding: '9px 12px', flexShrink: 0 }} onClick={() => {
                    const v = window.prompt('Nom du nouveau pays :')
                    if (v && v.trim()) setFormData(p => ({ ...p, pays: v.trim(), region: '', appellation: '', cepage: '' }))
                  }} title="Ajouter un nouveau pays">+</button>
                </div>
              </div>
              <div>
                <label style={S.formLabel}>Région</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.region} onChange={e => setFormData(p => ({ ...p, region: e.target.value, appellation: '', cepage: '' }))}>
                    <option value="">—</option>
                    {regionsDisponibles.map(r => <option key={r}>{r}</option>)}
                    {formData.region && !regionsDisponibles.includes(formData.region) && <option key={formData.region}>{formData.region}</option>}
                  </select>
                  <button type="button" style={{ ...S.btnOutline, padding: '9px 12px', flexShrink: 0 }} onClick={() => ajouterValeurReferentiel('region')} title="Ajouter une nouvelle région">+</button>
                </div>
              </div>
              <div>
                <label style={S.formLabel}>Appellation</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.appellation} onChange={e => setFormData(p => ({ ...p, appellation: e.target.value, cepage: '' }))}>
                    <option value="">—</option>
                    {appellationsDisponibles.map(a => <option key={a}>{a}</option>)}
                    {formData.appellation && !appellationsDisponibles.includes(formData.appellation) && <option key={formData.appellation}>{formData.appellation}</option>}
                  </select>
                  <button type="button" style={{ ...S.btnOutline, padding: '9px 12px', flexShrink: 0 }} onClick={() => ajouterValeurReferentiel('appellation')} title="Ajouter une nouvelle appellation">+</button>
                </div>
              </div>
              <div>
                <label style={S.formLabel}>Cépage</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.cepage} onChange={e => setFormData(p => ({ ...p, cepage: e.target.value }))}>
                    <option value="">—</option>
                    {cepagesDisponibles.map(c => <option key={c}>{c}</option>)}
                    {formData.cepage && !cepagesDisponibles.includes(formData.cepage) && <option key={formData.cepage}>{formData.cepage}</option>}
                  </select>
                  <button type="button" style={{ ...S.btnOutline, padding: '9px 12px', flexShrink: 0 }} onClick={() => ajouterValeurReferentiel('cepage')} title="Ajouter un nouveau cépage">+</button>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: '#CCC', marginTop: -8, marginBottom: 16 }}>
              💡 Utilisez le bouton <b>+</b> pour ajouter une région, appellation ou cépage absent des listes — elle sera proposée automatiquement la prochaine fois.
            </div>

            {/* Stock & emplacement */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>📦 Stock & emplacement</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div><label style={S.formLabel}>Quantité</label><input type="number" style={S.formInput} value={formData.quantite} onChange={e => setFormData(p => ({ ...p, quantite: e.target.value }))} /></div>
              <div>
                <label style={S.formLabel}>Emplacement</label>
                <select style={{ ...S.formInput, cursor: 'pointer' }} value={formData.emplacement} onChange={e => setFormData(p => ({ ...p, emplacement: e.target.value }))}>
                  <option value="">—</option>
                  {emplacements.map(e => <option key={e.code} value={e.code}>{e.code} — {e.zone}</option>)}
                </select>
              </div>
            </div>

            {/* Achat */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>💶 Informations d'achat</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div><label style={S.formLabel}>Date d'achat</label><input type="date" style={S.formInput} value={formData.date_achat} onChange={e => setFormData(p => ({ ...p, date_achat: e.target.value }))} /></div>
              <div><label style={S.formLabel}>Vendeur</label><input style={S.formInput} value={formData.vendeur} onChange={e => setFormData(p => ({ ...p, vendeur: e.target.value }))} /></div>
              <div><label style={S.formLabel}>Prix unitaire (€)</label><input type="number" style={S.formInput} value={formData.prix_unitaire} onChange={e => setFormData(p => ({ ...p, prix_unitaire: e.target.value }))} /></div>
              <div>
                <label style={S.formLabel}>Valeur totale</label>
                <div style={{ ...S.formInput, color: '#999', display: 'flex', alignItems: 'center' }}>
                  {formData.quantite && formData.prix_unitaire ? fmt(+formData.quantite * +formData.prix_unitaire) : '—'}
                </div>
              </div>
            </div>

            {/* Garde */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>⏳ Garde & consommation</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div><label style={S.formLabel}>Date d'apogée (année)</label><input type="number" style={S.formInput} placeholder="2028" value={formData.date_apogee} onChange={e => setFormData(p => ({ ...p, date_apogee: e.target.value }))} /></div>
              <div><label style={S.formLabel}>Fenêtre de consommation</label><input style={S.formInput} placeholder="2024-2035" value={formData.fenetre_consommation} onChange={e => setFormData(p => ({ ...p, fenetre_consommation: e.target.value }))} /></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={S.formLabel}>Notes</label>
              <input style={S.formInput} placeholder="Grand Cru Classé, cadeau, etc." value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} />
            </div>

            {/* Dégustation / accords */}
            <div style={{ fontSize: 11, color: '#999', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>🍽 Notes personnelles</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={S.formLabel}>Note perso (0-100)</label><input type="number" style={S.formInput} value={formData.note_perso} onChange={e => setFormData(p => ({ ...p, note_perso: e.target.value }))} /></div>
              <div><label style={S.formLabel}>Accords (séparés par virgule)</label><input style={S.formInput} placeholder="Agneau, fromages…" value={formData.accords} onChange={e => setFormData(p => ({ ...p, accords: e.target.value }))} /></div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.formLabel}>Commentaire de dégustation</label>
              <textarea style={{ ...S.formInput, minHeight: 65, resize: 'vertical' }} value={formData.commentaire_degustation} onChange={e => setFormData(p => ({ ...p, commentaire_degustation: e.target.value }))} />
            </div>

            <button style={{ ...S.btnPrimary, width: '100%', padding: 13, fontSize: 15, justifyContent: 'center' }} onClick={enregistrerVin} disabled={saving || !formData.nom}>
              {saving ? <><Spinner /> Sauvegarde…</> : editingId ? 'Enregistrer les modifications' : "Ajouter à l'inventaire"}
            </button>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'err' ? '#C04040' : '#111', color: '#fff', padding: '12px 22px', borderRadius: 30, fontSize: 14, fontWeight: 500, zIndex: 200, animation: 'fadeIn .2s ease', boxShadow: '0 8px 24px #00000030', whiteSpace: 'nowrap' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
