# 05 — Cache, panne et fraîcheur

Les APIs publiques peuvent être lentes, indisponibles ou momentanément incohérentes.
Le serveur conserve une réponse précédente lorsqu’un rafraîchissement échoue.
Cette réponse doit porter un avertissement visible et son âge exact.
Une donnée ancienne explicitement marquée vaut mieux qu’une donnée ancienne présentée comme actuelle.
Les limites de délai empêchent un appel MCP de rester bloqué sans borne.
Le cache ne doit pas mélanger les arguments de deux requêtes différentes.
Les erreurs gardent une enveloppe de réponse stable pour le client et le modèle.
La fraîcheur fait donc partie du sens de la donnée, pas seulement de son transport.

Sources : [README](../../README.md#disclaimer), [cache](../../src/core/cache.ts), [tests](../../test).

→ [Chapitre 06 — Invariants vérifiables](06-invariants-verifiables.md)
