# 06 — Invariants vérifiables et limites

Le script d’audit traduit les déclarations de sécurité en règles sur le code.
Il vérifie notamment fichiers, processus, sockets, environnement, signature et hôtes réseau.
Le contrôle du type Safe empêche d’ajouter silencieusement une seconde échappatoire.
Le preflight limite aussi le contenu publiable du paquet et recherche des éléments sensibles.
Ces contrôles rendent les régressions visibles, sans constituer une preuve formelle complète.
Un autre outil du même agent peut toujours transformer une sortie en action dangereuse.
Le parcours décrit les invariants et les limites à vérifier lors de chaque évolution.
Aucune installation, compilation ou exécution n’a été réalisée pour cette documentation.
La suite test et les scripts du dépôt restent la référence reproductible.

Sources : [audit](../../scripts/audit.mjs), [preflight](../../scripts/preflight.mjs), [SECURITY](../../SECURITY.md).
