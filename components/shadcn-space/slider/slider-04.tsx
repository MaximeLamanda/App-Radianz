"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { Slider } from "@/components/ui/slider";

function SliderDemo() {
  const [value, setValue] = useState<number[]>([28.1]);

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xl font-semibold tracking-tight text-foreground">
          Volume
        </p>
        <div className="text-xl font-medium text-foreground">
          <NumberFlow
            value={value[0]}
            format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
          />
          <span className="ml-0.5">%</span>
        </div>
      </div>

      <Slider
        variant="slider04"
        value={value}
        onValueChange={(val) => setValue(Array.isArray(val) ? val : [val])}
        min={0}
        max={100}
        step={0.1}
        aria-label="Volume"
      />
    </div>
  );
}

export default SliderDemo;
