# 04 — Données manquantes et unités

Une donnée absente n’est pas égale à zéro.
Le serveur affiche n/a lorsque la source ne permet pas de soutenir un chiffre.
Les taux de prêt proviennent parfois d’un endpoint distinct des métadonnées de pool.
Les jointures reposent alors sur l’identifiant de pool, pas sur un nom approximatif.
APY, taux de base et émissions sont conservés comme mesures différentes.
Les variations en points de pourcentage ne doivent pas devenir des pourcentages relatifs.
Le cas HLP illustre aussi le refus d’afficher un APR dont la convention est ambiguë.
Montrer l’incertitude protège mieux l’utilisateur qu’une précision inventée.

Sources : [README](../../README.md#three-details-worth-knowing), [tests](../../test).

→ [Chapitre 05 — Cache et fraîcheur](05-cache-et-fraicheur.md)
