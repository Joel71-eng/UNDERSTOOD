import React, { useEffect, useRef, useState } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";

// Mobile equivalent of the web composer's spinning conic-gradient ring. React Native has no
// conic-gradient and no gradient library in this project, so instead of a filled ring, three small dots
// (fixed colors, no color animation) chase each other around the rectangle's perimeter.
//
// Previous version crashed on real devices: it mixed a native-driven position animation (transform,
// useNativeDriver:true) and a JS-driven color animation (backgroundColor/shadowColor,
// useNativeDriver:false) on the SAME Animated.View. RN's native-animated module marks the *entire*
// AnimatedProps node native as soon as any one of its animated values starts with useNativeDriver:true,
// which propagates to every style key on that view - including the JS-driven color one - and then two
// things break at once: shadowColor isn't a style the native animated module supports at all ("Style
// property 'shadowColor' is not supported by native animated module"), and the color loop then tries to
// start a JS-driven step on a node that's already been claimed by the native driver ("Attempting to run
// JS driven animation on animated node that has been moved to 'native'"). Exactly the crash reported.
//
// Fix: drop color animation entirely and use ONLY native-driver-safe values (transform via translateX/Y)
// for all three dots. Phase offsets for the trailing dots come from Animated.modulo/Animated.add, which
// are themselves native-driver-compatible, so all three stay on one animation with zero JS-thread work
// and nothing that can trigger the native/JS driver conflict again.
const DOT_COLORS = ["#2d6cdf", "#7b2ff7", "#ff2d78"];
const PHASES = [0, 1 / 3, 2 / 3];

export default function GlowBorder({ active, borderRadius = 27, style, children }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const progress = useRef(new Animated.Value(0)).current;
  const loopRef = useRef(null);

  useEffect(() => {
    if (active) {
      progress.setValue(0);
      loopRef.current = Animated.loop(
        Animated.timing(progress, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: true })
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      progress.setValue(0);
    }
    return () => loopRef.current?.stop();
  }, [active]);

  const { width: w, height: h } = size;
  const canAnimate = active && w > 2 && h > 2;

  let dots = [];
  if (canAnimate) {
    const perimeter = 2 * (w + h);
    const atTopRight = w / perimeter;
    const atBottomRight = (w + h) / perimeter;
    const atBottomLeft = (2 * w + h) / perimeter;
    const inputRange = [0, atTopRight, atBottomRight, atBottomLeft, 1];
    dots = PHASES.map((phase, i) => {
      // Animated.modulo(Animated.add(progress, phase), 1) - a phase-shifted copy of the same 0..1 loop,
      // built entirely from native-driver-safe operators (no new Animated.Value/timing needed per dot).
      const shifted = Animated.modulo(Animated.add(progress, phase), 1);
      return {
        key: i,
        color: DOT_COLORS[i],
        translateX: shifted.interpolate({ inputRange, outputRange: [0, w, w, 0, 0] }),
        translateY: shifted.interpolate({ inputRange, outputRange: [0, 0, h, h, 0] }),
      };
    });
  }

  return (
    <View style={[style, { borderRadius, overflow: "hidden" }]} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {dots.map((d) => (
        <Animated.View
          key={d.key}
          pointerEvents="none"
          // shadowColor here is a plain (non-animated) style value, unlike the crash-causing version -
          // only backgroundColor and transform are driven by Animated, so there's nothing for the native
          // animated module to reject.
          style={[s.light, { backgroundColor: d.color, shadowColor: d.color, transform: [{ translateX: d.translateX }, { translateY: d.translateY }] }]}
        />
      ))}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  light: {
    position: "absolute",
    top: -7,
    left: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOpacity: 0.85,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
