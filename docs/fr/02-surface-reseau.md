# 02 — Surface réseau et SSRF

Les appels sortants passent par un wrapper commun dans src/core/http.ts.
Quatre hôtes publics sont codés en dur pour Hyperliquid et DefiLlama.
Aucun outil n’accepte d’URL, d’hôte ou d’endpoint fourni par le modèle.
Cette propriété ferme la voie classique de SSRF vers une cible choisie par l’appelant.
HTTPS est imposé et une redirection est traitée comme une erreur.
La validation doit continuer à porter sur l’URL finale et les délais réseau.
Centraliser les appels rend la liste d’autorisation mécaniquement vérifiable.
Ajouter une nouvelle source doit donc être une modification de code explicite et révisable.

Sources : [wrapper HTTP](../../src/core/http.ts), [audit](../../scripts/audit.mjs).

→ [Chapitre 03 — Texte hostile](03-texte-hostile.md)
