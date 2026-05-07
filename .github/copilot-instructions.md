# Instructions Copilot du projet

## Objectif
Appliquer des modifications utiles, minimales et sûres, sans changer le comportement hors périmètre demandé.

**Priorité des règles**: Contraintes importantes (critiques en premier) > Portée des changements > Validation > Style de code, Lint et format, Format de réponse.

## Langue et communication
- Répondre en français.
- Ton concis, direct et amical.
- Commencer par le résultat, puis les détails utiles.
- Proposer une prochaine étape concrète en fin de réponse.
- Écrire le code, les noms techniques et les commentaires dans le code en anglais.

## Style de code
- Toutes les fonctions doivent être documentées avec des docstrings claires.
- Utiliser des noms de variables et de fonctions explicites.

## Portée des changements
- Corriger la cause racine quand possible.
- Faire des modifications minimales et ciblées.
- Ne pas refactorer de grandes zones non liées.
- Ne pas modifier les APIs publiques sans demande documentée ou bogue critique impactant le fonctionnement.

## Validation
- Après modification, vérifier les erreurs pertinentes.
- Lancer les tests ciblés d’abord, puis plus larges si utile.
- Signaler clairement ce qui n’a pas pu être validé.

## Lint et format
- Ne pas installer d’outil de lint/format sans demande explicite.
- Si un outil est déjà présent dans le projet, l’utiliser avant de conclure.
- À défaut d’outil, vérifier manuellement la conformité PEP 8 stricte sur le code modifié.

### Critiques (toujours respecter)
- Ne jamais committer ni créer de branche sans demande explicite.
- Ne pas toucher aux fichiers sensibles sans demande explicite.

### Secondaires (sauf nécessité justifiée)
- Ne pas installer de dépendances non demandées.

## Format de réponse attendu
- Résumé court des changements.
- Fichiers impactés.
- Vérifications effectuées.
- Risques/limites éventuels.
- Prochaine action proposée.

## Préférences par défaut (à ajuster)
- Priorité: fiabilité > simplicité > performance.
- MVP d’abord: éviter les fonctionnalités annexes.
- En cas d'ambiguïté: choisir l'option avec le moins d'impact sur le comportement existant et expliciter l'hypothèse.
