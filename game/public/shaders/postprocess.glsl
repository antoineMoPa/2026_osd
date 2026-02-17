// Post-processing fragment shader
// textureSampler: the rendered scene texture
// time: elapsed time in seconds

uniform sampler2D textureSampler;
uniform float time;
uniform vec2 resolution;

void main() {
    // Calculate normalized screen coordinates from fragment position
    vec2 vUv = gl_FragCoord.xy / resolution;

    // Sample the rendered scene
    vec4 sceneColor = texture2D(textureSampler, vUv);

    // Example: simple color shift
    vec3 color = sceneColor.rgb;

    // 3x3 box blur
    vec2 texel = 2.0 / resolution;
    vec3 blur = vec3(0.0);
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            blur += texture2D(textureSampler, vUv + vec2(float(x), float(y)) * texel).rgb;
        }
    }

    // highligh
    float highlight = clamp(pow(length(blur/9.0) * 2.0, 8.0), 0.0, 1.0) * 0.8;

    color = color + blur / 9.0 + highlight * color;

    // Vignette effect
    float vignette = 1.0 - pow(length(vUv - 0.5), 4.0) * 3.0;
    color *= vignette;


    // Re-apply vignette after blur
    color *= vignette;

    gl_FragColor = vec4(color, sceneColor.a);
}
