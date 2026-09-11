# 03 — Texte tiers et injection indirecte

Les noms de validateurs et de protocoles sont du texte contrôlé par des tiers.
Ce texte rejoint le contexte d’un agent et doit être considéré comme hostile.
Le serveur évite d’abord les champs libres inutiles, notamment les descriptions.
Les champs conservés sont normalisés en NFKC puis filtrés par liste de caractères admis.
Les marqueurs de gabarit, fences et séparateurs de tableaux ne survivent pas au filtre.
Le type Safe distingue ensuite le texte nettoyé des chaînes ordinaires.
Les renderers n’acceptent que ce type, transformant un oubli en erreur de compilation.
Le texte anglais banal reste possible : aucun filtre ne résout entièrement l’injection.

Sources : [SECURITY](../../SECURITY.md), [sanitisation](../../src/core/safe.ts).

→ [Chapitre 04 — Données et unités](04-donnees-et-unites.md)
