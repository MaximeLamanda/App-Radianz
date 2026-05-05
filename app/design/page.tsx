"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, Settings } from "lucide-react";

function WithTooltip({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

export default function DesignPage() {
  return (
    <TooltipProvider>
      <ScrollArea className="h-full w-full">
        <div className="p-5 md:p-6 max-w-4xl mx-auto space-y-12">
          <header>
            <h1 className="text-2xl font-bold tracking-tight">Éléments du site</h1>
            <p className="text-muted-foreground mt-1">
              Référence de tous les composants shadcn utilisés sur le site. Survolez un élément pour voir son nom.
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Boutons</h2>
            <div className="flex flex-wrap gap-3 items-center">
              <WithTooltip name="Button (default)">
                <Button>Default</Button>
              </WithTooltip>
              <WithTooltip name="Button (secondary)">
                <Button variant="secondary">Secondary</Button>
              </WithTooltip>
              <WithTooltip name="Button (destructive)">
                <Button variant="destructive">Destructive</Button>
              </WithTooltip>
              <WithTooltip name="Button (outline)">
                <Button variant="outline">Outline</Button>
              </WithTooltip>
              <WithTooltip name="Button (ghost)">
                <Button variant="ghost">Ghost</Button>
              </WithTooltip>
              <WithTooltip name="Button (link)">
                <Button variant="link">Link</Button>
              </WithTooltip>
              <WithTooltip name="Button (lime)">
                <Button variant="lime">Lime</Button>
              </WithTooltip>
              <WithTooltip name="Button (sm)">
                <Button size="sm">Small</Button>
              </WithTooltip>
              <WithTooltip name="Button (lg)">
                <Button size="lg">Large</Button>
              </WithTooltip>
              <WithTooltip name="Button (icon)">
                <Button size="icon" variant="secondary">
                  <Settings className="h-4 w-4" />
                </Button>
              </WithTooltip>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Champs & formulaires</h2>
            <div className="grid gap-4 max-w-sm">
              <div className="space-y-2">
                <WithTooltip name="Label">
                  <Label htmlFor="demo-input">Label</Label>
                </WithTooltip>
                <WithTooltip name="Input">
                  <Input id="demo-input" placeholder="Placeholder" className="border-0 bg-secondary focus-visible:ring-0 focus-visible:ring-offset-0" />
                </WithTooltip>
              </div>
              <div className="flex items-center gap-2">
                <WithTooltip name="Switch">
                  <Switch id="demo-switch" defaultChecked />
                </WithTooltip>
                <Label htmlFor="demo-switch">Switch</Label>
              </div>
              <div className="space-y-2">
                <Label>Select</Label>
                <WithTooltip name="Select">
                  <Select defaultValue="a">
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a">Option A</SelectItem>
                      <SelectItem value="b">Option B</SelectItem>
                      <SelectItem value="c">Option C</SelectItem>
                    </SelectContent>
                  </Select>
                </WithTooltip>
              </div>
              <div className="space-y-2">
                <Label>Slider</Label>
                <WithTooltip name="Slider">
                  <Slider defaultValue={[50]} max={100} step={1} />
                </WithTooltip>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Cartes</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <WithTooltip name="Card">
                <Card>
                  <CardHeader>
                    <CardTitle>Titre de carte</CardTitle>
                    <CardDescription>Description optionnelle de la carte.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Contenu de la carte.
                    </p>
                  </CardContent>
                </Card>
              </WithTooltip>
              <WithTooltip name="Card">
                <Card>
                  <CardHeader>
                    <CardTitle>Avec bouton</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button size="sm">Action</Button>
                  </CardContent>
                </Card>
              </WithTooltip>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Badges</h2>
            <div className="flex flex-wrap gap-2">
              <WithTooltip name="Badge default (canvas Radianz)">
                <Badge>Default</Badge>
              </WithTooltip>
              <WithTooltip name="Badge secondary (neutre)">
                <Badge variant="secondary">Secondary</Badge>
              </WithTooltip>
              <WithTooltip name="Badge lime">
                <Badge variant="lime">Lime</Badge>
              </WithTooltip>
              <WithTooltip name="Badge solid (encre)">
                <Badge variant="solid">Solid</Badge>
              </WithTooltip>
              <WithTooltip name="Badge muted">
                <Badge variant="muted">Muted</Badge>
              </WithTooltip>
              <WithTooltip name="Badge destructive">
                <Badge variant="destructive">Destructive</Badge>
              </WithTooltip>
              <WithTooltip name="Badge outline">
                <Badge variant="outline">Outline</Badge>
              </WithTooltip>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Onglets</h2>
            <WithTooltip name="Tabs">
              <Tabs defaultValue="tab1" className="w-full max-w-md">
                <TabsList>
                  <TabsTrigger value="tab1">Onglet 1</TabsTrigger>
                  <TabsTrigger value="tab2">Onglet 2</TabsTrigger>
                  <TabsTrigger value="tab3">Onglet 3</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1" className="p-4 border border-border rounded-md mt-2">
                  Contenu de l’onglet 1.
                </TabsContent>
                <TabsContent value="tab2" className="p-4 border border-border rounded-md mt-2">
                  Contenu de l’onglet 2.
                </TabsContent>
                <TabsContent value="tab3" className="p-4 border border-border rounded-md mt-2">
                  Contenu de l’onglet 3.
                </TabsContent>
              </Tabs>
            </WithTooltip>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Progress & Slider</h2>
            <div className="space-y-4 max-w-sm">
              <div>
                <Label className="text-muted-foreground">Progress 60%</Label>
                <WithTooltip name="Progress">
                  <Progress value={60} className="mt-1" />
                </WithTooltip>
              </div>
              <div>
                <Label className="text-muted-foreground">Slider</Label>
                <WithTooltip name="Slider">
                  <Slider defaultValue={[25]} max={100} className="mt-1" />
                </WithTooltip>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Alertes</h2>
            <div className="space-y-3">
              <WithTooltip name="Alert (default)">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Alert par défaut</AlertTitle>
                  <AlertDescription>
                    Message d’information.
                  </AlertDescription>
                </Alert>
              </WithTooltip>
              <WithTooltip name="Alert (destructive)">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Erreur</AlertTitle>
                  <AlertDescription>
                    Variante destructive.
                  </AlertDescription>
                </Alert>
              </WithTooltip>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b border-border pb-2">Séparateur</h2>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Au-dessus</p>
              <WithTooltip name="Separator">
                <Separator />
              </WithTooltip>
              <p className="text-sm text-muted-foreground">En dessous</p>
            </div>
          </section>
        </div>
      </ScrollArea>
    </TooltipProvider>
  );
}
