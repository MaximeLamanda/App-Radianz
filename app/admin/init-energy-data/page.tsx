"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function InitEnergyDataPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const handleInit = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/init-energy-data");
      const data = await response.json();
      
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-6">Initialisation des Données de Consommation Énergétique</h1>
      
      <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
        <p className="text-gray-700">
          Cette page permet d'initialiser les données de consommation énergétique par type de bâtiment
          dans Firebase Firestore (consommation annuelle et <strong>mensuelle</strong> en kWh/m²).
        </p>
        
        <p className="text-sm text-gray-500">
          Collection : <code className="bg-gray-100 px-2 py-1 rounded">building_energy_consumption</code>
        </p>

        <Button
          onClick={handleInit}
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? "Initialisation en cours..." : "Initialiser les données dans Firebase"}
        </Button>

        {result && (
          <div
            className={`p-4 rounded-md ${
              result.success
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {result.success ? (
              <div>
                <p className="font-semibold">✅ Succès !</p>
                <p>{result.message}</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold">❌ Erreur</p>
                <p>{result.error}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 pt-6 border-t">
          <h2 className="font-semibold mb-2">Types de bâtiments qui seront initialisés :</h2>
          <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
            <li>Retail / Commerce (store, shopping_mall, etc.)</li>
            <li>Supermarkets (supermarket, grocery_or_supermarket)</li>
            <li>Restaurants / Hospitality (restaurant, cafe, bar)</li>
            <li>Offices (office, bank, lawyer, etc.)</li>
            <li>Warehouses (warehouse, storage)</li>
            <li>Industrial (factory, industrial, manufacturing)</li>
            <li>Sport / Fitness (gym, fitness_center, swimming_pool)</li>
            <li>Et plus...</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
