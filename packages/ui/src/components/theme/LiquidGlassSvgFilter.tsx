import React from 'react';

export const LiquidGlassSvgFilter: React.FC = () => {
  return (
    <svg
      aria-hidden="true"
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
      colorInterpolationFilters="sRGB"
    >
      <defs>
        {/* SVG Displacement Map Refraction Filter matching Shu Ding's liquid-glass specification */}
        <filter id="liquid-glass-refraction" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02"
            numOctaves="2"
            seed="42"
            result="liquid_noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="liquid_noise"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced_graphic"
          />
          <feColorMatrix
            in="displaced_graphic"
            type="saturate"
            values="1.2"
            result="saturated_graphic"
          />
        </filter>
      </defs>
    </svg>
  );
};
