# EdgePulse PWA · 2.0.1

Ce dossier constitue la totalité du site à héberger. Aucun backend ni framework n’est nécessaire pour l’inférence.

Depuis ce dossier :

```bash
python -m http.server 8080
```

Ouvrir http://localhost:8080/ et attendre « Opérationnel » puis « Disponible hors ligne ».

Pour accéder directement au formulaire : http://localhost:8080/#tester. Ne double-cliquez pas sur `index.html` pour tester le modèle : une URL `file://` ne permet pas de charger normalement les modules et le service worker. Le menu fonctionne désormais indépendamment du chargement du modèle et affiche une explication si celui-ci échoue.

Le modèle JSON contient les 263 paramètres PyTorch d’origine, le RobustScaler, le seuil et les métriques. `model.js` effectue l’inférence réelle. Les exemples remplissent les champs sans simuler de résultat.

Pour démontrer le mode hors ligne : ouvrez d’abord l’application en ligne, attendez « Disponible hors ligne », puis installez-la si votre navigateur le propose. L’installation reste facultative. Passez en mode avion, relancez l’application et effectuez une nouvelle analyse : 21.7 / 32 / 439 / 1200 donne NORMAL (score JS 0.009607099927961826) ; 75 / 30 / 430 / 800 donne ANOMALIE (208.31686401367188). Seuil : 0.015397730309654743. Un ancien résultat déjà affiché ne constitue pas un test hors ligne.

Pour Vercel, utiliser ce dossier comme Root Directory, Framework Other, aucun build, sortie `.`. Pour Netlify, le fichier `netlify.toml` de la racine configure ce dossier ; un dépôt manuel du dossier est aussi possible. Après une modification, incrémenter `VERSION` dans `sw.js`.

Le guide complet, le diagnostic, les résultats comparatifs, les tests reproductibles et la checklist sont dans le `README.md` à la racine du projet. L’inspection navigateur native n’a pas pu être exécutée pendant la correction : elle reste nécessaire avant la soutenance.
