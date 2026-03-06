"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface MapErrorBoundaryProps {
  children: React.ReactNode;
}

export function MapErrorBoundary({ children }: MapErrorBoundaryProps) {
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    // Écouter les erreurs Google Maps
    const handleError = (event: ErrorEvent) => {
      if (event.message?.includes("Google Maps") || event.filename?.includes("maps.googleapis.com")) {
        setHasError(true);
        setErrorMessage(event.message || "Erreur Google Maps");
      }
    };

    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("error", handleError);
    };
  }, []);

  if (hasError) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-muted p-6">
        <Card className="max-w-2xl w-full">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <CardTitle>Erreur de chargement Google Maps</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p className="mb-2">Google Maps n&apos;a pas pu se charger. Voici les étapes à suivre :</p>
              <ol className="list-decimal list-inside space-y-2 ml-2">
                <li>
                  <strong>Vérifiez votre clé API</strong> dans le fichier <code className="bg-muted px-1 rounded">.env.local</code>
                </li>
                <li>
                  <strong>Activez les APIs nécessaires</strong> dans Google Cloud Console :
                  <ul className="list-disc list-inside ml-4 mt-1">
                    <li>Maps JavaScript API</li>
                    <li>Maps Drawing API</li>
                  </ul>
                </li>
                <li>
                  <strong>Ajoutez les restrictions de domaine</strong> :
                  <ul className="list-disc list-inside ml-4 mt-1">
                    <li><code className="bg-muted px-1 rounded">localhost:3000</code></li>
                    <li><code className="bg-muted px-1 rounded">127.0.0.1:3000</code></li>
                  </ul>
                </li>
                <li>
                  <strong>Vérifiez la console du navigateur</strong> (F12) pour voir l&apos;erreur exacte
                </li>
              </ol>
            </div>
            {errorMessage && (
              <div className="text-xs bg-muted p-2 rounded font-mono">
                {errorMessage}
              </div>
            )}
            <Button
              onClick={() => {
                setHasError(false);
                window.location.reload();
              }}
              className="w-full"
            >
              Recharger la page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
