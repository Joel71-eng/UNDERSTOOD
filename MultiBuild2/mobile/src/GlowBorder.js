import React, { useEffect, useRef, useState } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";

// Mobile equivalent of the web composer's spinning conic-gradient ring. React Native has no
// conic-gradient and no expo-linear-gradient dependency in this project (adding one is a new native
// module + another "npm install" step on a phone that's already been through enough SDK-mismatch pain
// this round - not worth it for a glow effect), so instead of a filled gradient ring, a single small
// glowing dot (with a color that itself drifts through the same stops as the web ring) rides around the
// rectangle's perimeter using Animated.timing + interpolate - built-in RN APIs only, no new deps.
//
// Same two-layer trick as web's .composer/.composer-box split: the dot is painted first (so it's
// "behind" in paint order), then `children` is rendered on top of it. As long as the child you pass in
// has its own opaque background and a small margin (see App.js's `composerBox` style), the child covers
// the dot everywhere except that margin gap, which is what reads as "a light travelling the border"
// rather than a dot sliding across the middle of the box.
const COLOR_STOPS = ["#2d6cdf", "#7b2ff7", "#ff2d78", "#ffb02d", "#2d6cdf"];
const STOP_POSITIONS = [0, 0.25, 0.5, 0.75, 1];

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

  let translateX = 0;
  let translateY = 0;
  if (canAnimate) {
    // Perimeter positions of the box's four corners, as fractions of the full loop (0..1) - a dot
    // moving at constant speed along [0,1] traces top edge, right edge, bottom edge, left edge in turn.
    const perimeter = 2 * (w + h);
    const atTopRight = w / perimeter;
    const atBottomRight = (w + h) / perimeter;
    const atBottomLeft = (2 * w + h) / perimeter;
    translateX = progress.interpolate({
      inputRange: [0, atTopRight, atBottomRight, atBottomLeft, 1],
      outputRange: [0, w, w, 0, 0],
    });
    translateY = progress.interpolate({
      inputRange: [0, atTopRight, atBottomRight, atBottomLeft, 1],
      outputRange: [0, 0, h, h, 0],
    });
  }
  // Color interpolation needs the JS-driven (non-native) animated loop below since useNativeDriver can't
  // animate backgroundColor/shadowColor - a second, parallel Animated.Value kept purely for color avoids
  // forcing the position animation (which CAN use the native driver, and should for smoothness) onto the
  // slower JS thread just for this.
  const colorProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop;
    if (active) {
      colorProgress.setValue(0);
      loop = Animated.loop(Animated.timing(colorProgress, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: false }));
      loop.start();
    }
    return () => loop?.stop();
  }, [active]);
  const dotColor = colorProgress.interpolate({ inputRange: STOP_POSITIONS, outputRange: COLOR_STOPS });

  return (
    <View style={[style, { borderRadius, overflow: "hidden" }]} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {canAnimate && (
        <Animated.View
          pointerEvents="none"
          style={[s.light, { backgroundColor: dotColor, shadowColor: dotColor, transform: [{ translateX }, { translateY }] }]}
        />
      )}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  light: {
    position: "absolute",
    top: -8,
    left: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
