# Guide de Détection Automatique de Toits

Ce guide explique comment mettre en place la détection automatique de toits sur les images satellites de Google Maps.

## Vue d'ensemble

La détection de toits fonctionne en plusieurs étapes :
1. **Récupération de l'image** : L'image satellite est récupérée depuis Google Maps Static API
2. **Envoi à l'algorithme** : L'image est envoyée à un service de détection (YOLO, API cloud, etc.)
3. **Traitement** : Le service détecte les toits et retourne des polygones avec coordonnées
4. **Affichage** : Les toits détectés sont affichés sur la carte et ajoutés au prospect

## Options d'hébergement

### Option 1 : Service Python avec YOLO (Recommandé pour production)

**Avantages :**
- Contrôle total sur le modèle
- Meilleure précision avec YOLOv8/YOLOv11
- Coût réduit à long terme
- Possibilité d'entraîner sur vos propres données

**Inconvénients :**
- Nécessite un ation initiale plus complexe

#### Architecture recommandée

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Next.js App   │ ──────> │  API Route       │ ──────> │  Python API  │
│   (Frontend)    │         │  /api/detect-    │         │  (FastAPI)   │
│                 │         │  rooftop         │         │  + YOLO      │
└─────────────────┘         └──────────────────┘         └──────────────┘
```

#### Mise en place

1. **Créer un service Python avec FastAPI**

Créez un nouveau dossier `rooftop-detection-service/` :

```bash
mkdir rooftop-detection-service
cd rooftop-detection-service
python -m venv venv
source venv/bin/activate  # Sur Windows: venv\Scripts\activate
pip install fastapi uvicort List, Dict

app = FastAPI()

# Charger le modèle YOLO (vous devrez entraîner ou télécharger un modèle pré-entraîné)
# Pour commencer, utilisez un modèle généraliste et adaptez-le
model = YOLO("yolov8n-seg.pt")  # Modèle de segmentation YOLOv8

class DetectionRequest(BaseModel):
    image_url: str
    coordinates: Dict[str, float]
    width: int = 400
    height: int = 300
    zoom: int = 20

class RooftopDetection(BaseModel):
    polygon: List[Dict[str, float]]
    area: float
    confidence: float
    boundingBox: Dict[str, float] = None

class DetectionResponse(BaseModel):
    success: bool
    rooftops: List[RooftopDetection]
    processingTime: float = None
    error: str = None

@app.post("/detect", response_model=DetectionResponse)
async def detect_rooftops(request: DetectionRequest):
    try:
        # Télécharger l'image depuis l'URL
        response = requests.get(request.image_url)
        response.raise_for_status()
        image = Image.open(io.BytesIO(response.content))
       nvertir en RGB si nécessaire
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        # Exécuter la détection YOLO
        results = model(image)
        
        rooftops = []
        for result in results:
            # YOLO retourne des masques de segmentation
            if result.masks is not None:
                for i, mask in enumerate(result.masks.data):
                    confidence = float(result.boxes.conf[i])
                    
                    # Filtrer les détections peu fiables
                    if confidence < 0.5:
                        continue
                    
                    # Convertir le masque en polygone
                    # Note: Cette partie nécessite une logique de conversion masque -> polygone
                    # Vous pouvez utiliser cv2.findContours ou une bibliothèque dédiée
                    
                    # Pour l'instant, utiliser la bounding box comme approximation
                    box = result.boxes.xpu().numpy()
                    x1, y1, x2, y2 = box
                    
                    # Convertir en coordonnées géographiques (approximation)
                    # Vous devrez implémenter la conversion pixel -> lat/lng
                    polygon = convert_pixel_to_geo(
                        [(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
                        request.width,
                        request.height,
                        request.coordinates,
                        request.zoom
                    )
                    
                    area = calculate_area(polygon)
                    
                    rooftops.append(RooftopDetection(
                        polygon=polygon,
                        area=area,
                        confidence=confidence,
                        boundingBox={
                            "x": float(x1),
                            "y": float(y1),
                            "width": float(x2 - x1),
                            "height": fl(y2 - y1)
                        }
                    ))
        
        return DetectionResponse(
            success=True,
            rooftops=rooftops,
            processingTime=0.0  # Mesurer le temps réellement
        )
    
    except Exception as e:
        return DetectionResponse(
            success=False,
            rooftops=[],
            error=str(e)
        )

def convert_pixel_to_geo(pixels, img_width, img_height, center_coords, zoom):
    # Implémentation de la conversion pixel -> coordonnées géographiques
    # Cette fonction doit être adaptée selon vos besoins
    pass

def calculate_area(polygon):
    # Calcul de l'aire d'un polygone en m²
    # Utiliser la formule de Shoelace
    pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

3. **Démarrer le service**

```bash
python main.py
```

4. **Configurer Next.js**

Ajoutez dans `.env.local` :

```env
ROOFTOP_DETECTION_API_URL=http://localhost:8000/detect
```

Pour la produtilisez l'URL de votre serveur déployé.

#### Hébergement du service Python

**Options recommandées :**
- **Railway** : https://railway.app (gratuit au début, facile)
- **Render** : https://render.com (gratuit au début)
- **Google Cloud Run** : Scalable, payant selon l'usage
- **AWS Lambda** : Si vous utilisez déjà AWS
- **VPS** : Contrôle total, nécessite maintenance

### Option 2 : AWS Rekognition Custom Labels

**Avantages :**
- Pas de serveur à gérer
- Scalable automatiquement
- Bonne précision après entraînement

**Inconvénients :**
- Coût par requête
- Nécessite un entraînement initial
- Dépendance à AWS

#### Mise en place

1. **Entraîner un modèle sur AWS Rekognition**
   - Téléchargez des images satellites avec toits annotés
   - Créez un projet dans AWS Rekognition Custom Labels
   - Entraînez le modèle

2. **Configurer les credentials AWS**

Dans `.env.local` :
```env
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=votre_cle
AWS_SECRET_ACCESS_KEY=votre_secret
```

3. **Modifi et complétez la section AWS dans `app/api/detect-rooftop/route.ts`

### Option 3 : Google Cloud Vision API

Similaire à AWS, mais avec Google Cloud. Nécessite un projet GCP et l'activation de l'API Vision.

## Modèles YOLO pré-entraînés pour toits

### Modèles disponibles

1. **YOLOv8 Segmentation** (recommandé)
   - Modèle généraliste : `yolov8n-seg.pt`, `yolov8s-seg.pt`, `yolov8m-seg.pt`
   - Nécessite un fine-tuning pour les toits

2. **YOLOv11** (dernière version)
   - Plus récent et performant
   - `yolo11n-seg.pt`, `yolo11s-seg.pt`, etc.

3. **Modèles spécialisés**
   - Recherchez sur GitHub : "rooftop detection YOLO"
   - Exemples : https://github.com/ai-arie/rooftop-objects-cv

### Entraînement d'un modèle personnalisé

1. **Collecter des données**
   - Images satellites de Google Maps (zoom 20)
   - Annoter avec LabelImg ou Roboflow

2. **Préparer le dataset**
   - Format YOLO (fichiers .txt avec annotations)
   - Diviser en train/val/test

3. **Entraîner**
   ```python
   YOLO
   
   model = YOLO("yolov8n-seg.pt")
   model.train(data="rooftop_dataset.yaml", epochs=100, imgsz=640)
   ```

## Intégration dans l'application

La détection est déjà intégrée dans le composant `SatelliteImage`. Pour l'activer :

1. Configurez votre service de détection (Option 1, 2 ou 3)
2. Ajoutez la variable d'environnement correspondante
3. La détection se déclenchera automatiquement quand une image satellite est chargée

## Coûts estimés

### Option 1 (Python/YOLO)
- **Développement** : Gratuit
- **Hébergement** : 
  - Railway/Render : Gratuit jusqu'à 500h/mois
  - Cloud Run : ~$0.10 par 1000 requêtes
  - VPS : ~$5-20/mois

### Option 2 (AWS Rekognition)
- **Entraînement** : ~$1-5 par heure d'entraînement
- **Inference** : ~$0.001-0.01 par image

### Option 3 (Google Cloud Vision)
- Similaire à AWS

## Prochaines étapes

1. **Choisir une option** selon vos besoins et budget
2. **Tester avec Option 1** (service Python local) pour valider le concept
3. **Déployer en productioonctionne
4. **Améliorer la précision** en entraînant sur vos propres données

## Ressources utiles

- YOLOv8 Documentation : https://docs.ultralytics.com
- FastAPI Documentation : https://fastapi.tiangolo.com
- AWS Rekognition : https://docs.aws.amazon.com/rekognition
- Exemples GitHub : Recherchez "rooftop segmentation satellite"
