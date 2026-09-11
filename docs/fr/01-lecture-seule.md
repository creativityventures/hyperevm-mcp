# 01 — Lecture seule par construction

Le serveur expose des données Hyperliquid et HyperEVM sans chemin d’écriture.
Aucune fonction de signature ou d’envoi de transaction n’existe dans le paquet.
Cette absence de capacité est plus forte qu’une option désactivée par défaut.
Le serveur ne lit ni clé privée ni variable d’environnement.
Il n’accède pas au système de fichiers et ne lance aucun processus.
Le transport standard est réservé au protocole MCP sur la sortie standard.
Même si une donnée externe influence le modèle, ce serveur ne peut déplacer des fonds.
La sécurité réelle dépend néanmoins des autres outils exposés au même agent.

Sources : [README](../../README.md#what-this-server-does-not-do), [audit](../../scripts/audit.mjs).

→ [Chapitre 02 — Surface réseau](02-surface-reseau.md)
