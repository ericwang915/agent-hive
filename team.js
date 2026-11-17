// Graph structure of a relay team. UMD: used by main (require) and by the pages (window.Team).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.Team = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // Upstream id list; also accepts legacy after.id
  const upIds = a => (a && a.after ? a.after.ids || (a.after.id ? [a.after.id] : []) : [])

  // Roots are 0, otherwise 1 + deepest upstream; on a cycle the back edge counts as 0
  function depthMap(agents) {
    const by = new Map(agents.map(a => [a.id, a])), d = {}
    const go = (id, seen) => {
      if (id in d) return d[id]
      if (seen.has(id)) return 0
      seen.add(id)
      const ups = upIds(by.get(id)).filter(u => by.has(u))
      return (d[id] = ups.length ? 1 + Math.max(...ups.map(u => go(u, seen))) : 0)
    }
    agents.forEach(a => go(a.id, new Set()))
    return d
  }

  // Follow after links both ways to get the whole team, sorted by depth (original order within a layer)
  function teamOf(agents, id) {
    const seen = new Set([id]), todo = [id]
    while (todo.length) {
      const cur = todo.pop(), a = agents.find(x => x.id === cur)
      const near = [...upIds(a), ...agents.filter(b => upIds(b).includes(cur)).map(b => b.id)]
      for (const n of near) if (!seen.has(n) && agents.some(x => x.id === n)) { seen.add(n); todo.push(n) }
    }
    const d = depthMap(agents)
    return agents.filter(a => seen.has(a.id)).sort((x, y) => d[x.id] - d[y.id])
  }

  function layersOf(agents, id) {
    const d = depthMap(agents), out = []
    for (const a of teamOf(agents, id)) (out[d[a.id]] = out[d[a.id]] || []).push(a)
    return out.filter(Boolean)
  }

  const layerOf = (agents, id) => layersOf(agents, id).find(l => l.some(a => a.id === id)) || []
  const isParallel = (agents, id) => layerOf(agents, id).length > 1
  const downOf = (agents, id) => agents.filter(b => upIds(b).includes(id))
  const inTeam = (agents, id) => teamOf(agents, id).length > 1
  // Lead: no upstream, has downstream
  const isLead = (agents, a) => !!a && !upIds(a).length && downOf(agents, a.id).length > 0
  const leadOf = (agents, id) => teamOf(agents, id)[0]

  return { upIds, depthMap, teamOf, layersOf, layerOf, isParallel, downOf, inTeam, isLead, leadOf }
})
