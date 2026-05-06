"use client";

import { useEffect, useState } from "react";

interface GoogleMapsLoaderProps {
  children: React.ReactNode;
  /**
   * Si `false`, affiche toujours les enfants pendant le chargement (ex. drawer Découverte sans carte).
   * Comportement historique : `true` (écran « Chargement de la carte… » jusqu’à `isLoaded`).
   */
  blockingLoad?: boolean;
}

export function GoogleMapsLoader({ children, blockingLoad = true }: GoogleMapsLoaderProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey || apiKey.trim() === "") {
      setError("Veuillez configurer NEXT_PUBLIC_GOOGLE_MAPS_API_KEY dans .env.local avec votre clé API Google Maps");
      return;
    }

    // Vérifier si Google Maps est déjà chargé
    if (window.google && window.google.maps && window.google.maps.Map) {
      setIsLoaded(true);
      return;
    }

    // Vérifier si le script est déjà en cours de chargement
    const existingScript = document.querySelector(
      `script[src*="maps.googleapis.com"]`
    );
    if (existingScript) {
      // Attendre que le script existant se charge avec timeout
      let attempts = 0;
      const maxAttempts = 50; // 5 secondes max
      const checkLoaded = setInterval(() => {
        attempts++;
        if (window.google && window.google.maps && window.google.maps.Map) {
          setIsLoaded(true);
          clearInterval(checkLoaded);
        } else if (attempts >= maxAttempts) {
          setError("Timeout lors du chargement de Google Maps. Vérifiez votre clé API.");
          clearInterval(checkLoaded);
        }
      }, 100);

      return () => clearInterval(checkLoaded);
    }

    // Origine actuelle (ex. localhost:3001) pour les restrictions de clé API
    const origin = typeof window !== "undefined" ? `${window.location.hostname}${window.location.port ? `:${window.location.port}` : ""}` : "localhost:3000";
    const originPattern = `${window.location.protocol}//${origin}/*`;

    // Ajouter un callback d'erreur global pour Google Maps
    (window as any).gm_authFailure = () => {
      const detailedError =
        "Erreur ApiTargetBlockedMapError détectée.\n\n" +
        "Causes possibles :\n" +
        "1. Restrictions d'API trop strictes dans Google Cloud Console\n" +
        `2. Restrictions de domaine HTTP (ajoutez ${origin})\n` +
        "3. API Maps JavaScript non activée\n\n" +
        "SOLUTION RAPIDE :\n" +
        "Dans Google Cloud Console → Votre clé API →\n" +
        "- API restrictions : Sélectionnez 'Don't restrict key' temporairement\n" +
        "OU ajoutez 'Maps JavaScript API' à la liste\n" +
        `- Application restrictions (HTTP) : Ajoutez ${originPattern}\n\n` +
        "Vérifiez la console du navigateur (F12) pour plus de détails.";
      setError(detailedError);
      console.error("Google Maps Auth Failure - ApiTargetBlockedMapError - Vérifiez les restrictions d'API dans Google Cloud Console");
    };

    // Timeout de sécurité
    const timeout = setTimeout(() => {
      if (!isLoaded) {
        setError("Timeout lors du chargement de Google Maps. Vérifiez votre clé API et la console du navigateur.");
      }
    }, 10000); // 10 secondes

    // Callback global pour l'initialisation
    (window as any).initGoogleMaps = () => {
      clearTimeout(timeout);
      // Vérifier que l'API est bien chargée
      if (window.google && window.google.maps && window.google.maps.Map) {
        setIsLoaded(true);
        delete (window as any).initGoogleMaps; // Nettoyer le callback
      } else {
        setError("Google Maps API ne s'est pas chargée correctement. Vérifiez votre clé API et les restrictions de domaine.");
      }
    };

    // Charger le script Google Maps - SANS places pour éviter le blocage des nouveaux clients (mars 2025+)
    // La bibliothèque places sera chargée dynamiquement via importLibrary quand nécessaire
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initGoogleMaps&loading=async`;
    script.async = true;
    script.defer = true;
    
    script.onerror = () => {
      clearTimeout(timeout);
      const errorMsg = "Erreur lors du chargement de Google Maps. Causes possibles :\n" +
        "- Clé API invalide ou expirée\n" +
        "- Restrictions de domaine sur la clé API (ajoutez localhost:3000)\n" +
        "- API Maps JavaScript non activée dans Google Cloud Console\n" +
        "- Problème de connexion internet\n\n" +
        "Vérifiez la console du navigateur pour plus de détails.";
      setError(errorMsg);
      console.error("Erreur lors du chargement du script Google Maps");
      delete (window as any).initGoogleMaps; // Nettoyer le callback en cas d'erreur
    };

    document.head.appendChild(script);

    return () => {
      clearTimeout(timeout);
      // Ne pas nettoyer le script car il peut être utilisé par d'autres composants
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (blockingLoad && error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center max-w-md p-6">
          <div className="text-lg font-semibold mb-2 text-destructive">
            Erreur de chargement
          </div>
          <div className="text-sm text-muted-foreground mb-4 whitespace-pre-line">
            {error}
          </div>
          <div className="text-xs text-muted-foreground space-y-2">
            <p>Vérifiez la console du navigateur (F12) pour plus de détails techniques.</p>
            <p className="mt-2">
              <strong>Action rapide :</strong> Allez dans Google Cloud Console → APIs & Services → Credentials → 
              Votre clé API → Ajoutez <code className="bg-muted px-1 rounded">localhost:3000</code> aux restrictions HTTP.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (blockingLoad && !isLoaded) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">
            Chargement de la carte...
          </div>
          <div className="text-sm text-muted-foreground">
            Initialisation de Google Maps...
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
