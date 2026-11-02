# Missing item thumbnail reconstruction

Seven regular items have no installed baked PNG and retain Phosphor fallbacks.
Bounded geometry and full-color experiments recover useful source data but do not
establish faithful thumbnail reproduction.

The probes reuse installed asset readers and run separately from the application:
[geometry probe](../../tools/artwork_probe.py),
[color proof](../../tools/artwork_color_proof.py), and their
[geometry](../../desktop/python/tests/services/test_artwork_probe.py) and
[color](../../desktop/python/tests/services/test_artwork_color_proof.py) tests.
[Unity-native rendering](unity-native-thumbnail-feasibility.md) evaluates the
alternative of exporting assets into a matching Unity Editor.

## Provenance and method

Installed Steam build 26294889, serialized Unity 6000.3.17f1:

| Input                         | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `Managed/Assembly-CSharp.dll` | `aa6b1ce0deef8d2b7104a3722864c4ba94c107257726471f8e44b45c99e36888` |
| `resources.assets`            | `f5dbb9f8db2ebed48a76ab3981f629f8c331bc25f4d63b46bf6a87ddc40a133e` |
| `sharedassets0.assets`        | `531d9fe2f51fc526e16358645e51aa1aa2ed5ea89c49c4a115b15bb989e4dd4b` |

The probe reuses `ArtworkFileIndex`, canonical `_item_keys`, ResourceManager
lookup, the existing prefab-renderer traversal, pointer resolver, stream-range
validation, vertex reader, Texture2D parser and BC1/BC3 decoder. UnityPy 1.25.4
supplies existing native Transform, Camera, Mesh, Material and Shader readers and
`MeshHandler`; no parallel binary asset parser was introduced.

The diagnostic hierarchy additionally records authored activity, parent links and
local/world matrices, and must agree with the production walker's renderer set.
World matrices use parent multiplication of local translation, quaternion rotation
and scale, retaining nonuniform scale. Renderer admission accounts for ancestor
activity, renderer enabled flags and the authored camera layer mask. The battery
visual subtree is excluded according to the capture IL. These are serialized and
capture-specific states, not proof of all changes made by runtime scripts.

Mesh diagnostics validate vertex/index bounds, triangle topology, submesh ranges,
base vertices, normals and UV coverage before projection. Streamed vertex data is
read through the existing bounded range reader. Material diagnostics record shader
names/passes, properties, texture formats and decoded alpha ranges. Nonfinite
authored material sentinels are recorded as explicit strings such as `"inf"`;
transforms and vertex positions must remain finite.

## Coverage by item

Counts below are renderer instances, not unique meshes or completed images.
"Candidates" means enabled/active MeshRenderers, additionally filtered by the
authored camera mask where available. No replacement camera is invented for an
item without one. Null meshes, procedural geometry and rejected sources are
reported separately rather than counted as reconstructed parts.

| Item                      | Hierarchy nodes / MeshRenderers | Candidates | Readable mesh instances / submeshes / triangles | Camera                       | Missing requirements                                                                                                                                                    | Difficulty / confidence                                               |
| ------------------------- | ------------------------------: | ---------: | ----------------------------------------------: | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Cart Cannon               |                        104 / 36 |          9 |                                   6 / 6 / 1,416 | No maker or camera in prefab | Three built-in mesh references rejected; capture framing and Standard lighting/material response unproven; line/particle effects present.                               | High; high metadata confidence, low visual confidence                 |
| Cart Laser                |                        139 / 42 |         14 |                                   6 / 6 / 1,186 | No maker or camera in prefab | Eight built-in mesh references rejected; Standard and particle-unlit passes, alpha/emission and runtime effect visibility; no authored framing.                         | High; high metadata confidence, low visual confidence                 |
| Cart Medium               |                         48 / 30 |         19 |                                   5 / 5 / 2,430 | No maker or camera in prefab | Eight null meshes; six other candidates unresolved, including procedural text; Standard, particle and TMP shaders; one texture format unsupported; no authored framing. | High; high metadata confidence, low visual confidence                 |
| Leaf Blower               |                         50 / 14 |          2 |                                     2 / 2 / 894 | Authored perspective camera  | Camera inherits 0.9 scale; diagnostic refuses to infer its view matrix. Custom alpha-clip shader, normal/smoothness/emission behavior and lighting need proof.          | Medium–high; high geometry/material confidence, low visual confidence |
| Power Crystal             |                         15 / 11 |          1 |                                     1 / 1 / 140 | No maker or camera in prefab | Static body geometry readable; no authored framing. Metallic/smooth Standard response, tint/emission and runtime state remain unproven.                                 | Medium–high; high static-geometry confidence, low visual confidence   |
| Vehicle Semiscooter       |                        297 / 77 |         22 |                                 18 / 18 / 5,790 | Authored perspective camera  | Four candidates unresolved, including built-in meshes and generated text; Standard/particle/TMP shaders, non-BC textures, effect visibility and lighting.               | High; high partial-geometry confidence, low visual confidence         |
| Vehicle Semiscooter Small |                        274 / 68 |         13 |                                 12 / 12 / 4,566 | Authored perspective camera  | One built-in mesh candidate rejected; Standard/custom particle shaders, material response and runtime effect visibility/lighting.                                       | High; high partial-geometry confidence, low visual confidence         |

Difficulty is an engineering estimate, not a measured implementation schedule.
All seven exact canonical baked filenames remain absent in the inspected build.
Every recovered mesh instance in this table has normals and UV0 for every vertex;
each uses one triangle submesh with base vertex zero. Synthetic tests separately
exercise nonzero base vertices, invalid topology and invalid index ranges.

The missing built-in source is present under `REPO_Data/Resources`, but its header
is 6000.3.11f1. The reviewed artwork index rejects that version. This is an
explicit coverage gap, not evidence that the meshes do not exist. The experiment
does not widen the production allowlist or bypass the version check.

## Camera, lighting and shader evidence

Read-only dnfile 0.18.0 / dncil 1.0.2 inspection of the assembly above
established the following method/IL anchors (offsets exclude the method header):

- `ItemAttributes.IconCapture`, token `0x0600267c`: finds
  `BatteryVisualLogic` at `0x0002`, temporarily disables its GameObject at
  `0x0040`, enables `ItemManager.itemIconLights` at `0x004a`, invokes capture, and
  restores the previous states in its finally block.
- `SemiIconMaker.IconParent`, token `0x06003abe`: prefers the parent
  `ItemAttributes`, then cosmetic/player-menu owners, before the transform parent.
- `SemiIconMaker.CreateIconReadback`, token `0x06003abd`: moves the icon parent
  to `(-1000,-1000,-1000)` at `0x00ef`, disables fog at `0x00f5`, applies the
  maker's ambient color at `0x0100`, and calls `Camera.Render` at `0x011c`.
  Target, position, fog and ambient state are restored afterward.
- `SemiIconMaker.CreateIconFromRenderTexture`, token `0x06003ac2`, follows the
  corresponding synchronous capture path; `Camera.Render` is at `0x00aa`.

The three missing items with makers reference a 512 × 512, 8× MSAA render
target (`m_ColorFormat=8`, `m_DepthStencilFormat=94`, `m_SRGB=false`). Their cameras
are perspective, vertical FOV 26.9914665°, near/far 0.3 / 1000, full viewport,
zero lens shift, culling mask 9502721, transparent clear alpha, HDR/MSAA enabled
and occlusion culling disabled. Their maker ambient color is white.

| Prefab        | Camera local position    | Camera local quaternion `(x,y,z,w)`          |
| ------------- | ------------------------ | -------------------------------------------- |
| Leaf Blower   | `(1.920, 0.115, -1.873)` | `(-0.121438, -0.381411, 0.057250, 0.914604)` |
| Both scooters | `(-3.458, 1.172, 2.532)` | `(0.151623, 0.863681, -0.012898, 0.480520)`  |

These are local poses; parent transforms change world placement, including the
large scooter's pose. The JSON report records the composed matrices. Copying the
local pose directly into an unrelated scene would not reproduce that framing.

Leaf Blower's two visible parts (`Grid` and `fan`) share `LeafBlower material` and
`Semiwork/Alpha Clip`. Its albedo, emission and normal maps decode as 512px DXT5;
the roughness map decodes as DXT1. Albedo alpha spans 0–255 and `_Cutoff` is 0.5.
The authored `_AlbedoColor.a` is zero. Neither ignoring alpha nor multiplying it
by that value is justified without the shader's actual behavior. The previous
`_MainTex`-only probe therefore missed available textures, not absent artwork.
Normal-map alpha is not evidence of surface transparency.

The geometry projection does not implement game shaders, Standard's complete
lighting path, TMP-generated geometry, particle simulation, tone/color conversion,
MSAA resolve or final alpha composition. An ItemManager diagnostic using the wrong
endianness produced an invalid light pointer; little-endian decoding resolves the
four shared lights documented in the color proof. Four prefabs lack authored
maker/camera components in the inspected hierarchy; this does not prove that no
runtime setup exists.

Projection/culling interpretation was cross-checked with Unity's
[camera API](https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/camera),
[camera frustum documentation](https://docs.unity.com/en-us/engine/6000.3/manual/cameras/camera-view/understanding-frustum),
and [MeshRenderer material/submesh contract](https://docs.unity.com/en-us/engine/6000.3/manual/assets-and-media/asset-types/mesh/components-reference/class-mesh-renderer).
Those references explain API semantics; the installed evidence supplies the values.

## Geometry comparison

The bounded prototype projects actual mesh triangles using authored transforms
and cameras into an in-memory binary coverage mask. It compares that mask against
alpha ≥128 from existing local baked PNGs at their original 512px size. It does
not rescale, search camera settings, register masks to the reference, tune poses,
or save/display comparison images.

| Baked control      | Alpha intersection-over-union | Projected / baked pixel bounds `(left,top,right,bottom)` |
| ------------------ | ----------------------------: | -------------------------------------------------------- |
| Melee Baseball Bat |                      0.984477 | `(74,58,444,434)` / `(75,58,444,433)`                    |
| Cart Small         |                      0.996384 | `(33,64,467,455)` / `(34,65,466,454)`                    |
| Health Pack Small  |                      0.993787 | `(64,95,449,417)` / `(65,95,449,417)`                    |

This supports recovered transform composition, camera framing and some triangle
coverage. It does not establish RGB, shader, lighting or transparency fidelity,
and it is not a visual acceptance threshold. Cart Small still has unresolved
candidate geometry despite high overlap. Leaf Blower's scaled camera is rejected;
the scooters have partial projected coverage but no baked reference. Missing or
unsupported parts cannot be dismissed because a silhouette looks plausible.

## Running the geometry probe

From the repository root, use an environment containing the already locked
`UnityPy[ttgen]==1.25.4` package group. The application never invokes this module.

```powershell
$env:PYTHONPATH = 'desktop/python'
New-Item -ItemType Directory -Force build/item-thumbnail-proof | Out-Null
uv run --isolated --python 3.13 --locked --group package python -m tools.artwork_probe --game-dir 'E:\SteamLibrary\steamapps\common\REPO' > build/item-thumbnail-proof/report.json
```

The probe emits JSON to stdout; the output directory is ignored. Results contain relative source identities, file
watches, transforms and coverage metadata, never artwork pixels, mesh vertex
arrays or shader programs. Inputs are checked again before reporting success.

The CLI owns one disposable worker with a 120-second timeout. It caps native
serialized inputs at 8 files / 768 MiB, individual objects at 16 MiB, stream
reads at 64 MiB, vertices at 65,536 per mesh, triangles at 100,000 per
mesh, submeshes at 64, hierarchies at the existing 512-object bound,
coverage at 512px square, and JSON at 4 MiB. The worker's exit releases
native state on success, failure, cancellation or timeout. These are research
bounds, not a renderer memory/latency service guarantee. UnityPy native allocations
do not have an OS memory cap in this prototype.

The measured geometry run took 47.78 s, read 11.79 MiB of explicitly
requested stream ranges, and emitted 2,231,565 bytes of JSON. This includes ten
prefabs and three control comparisons. It is an audit measurement with OS caches
uncontrolled, not cold thumbnail generation, warm cache retrieval or app startup.
Production generation latency, warm/relaunch cache behavior and renderer memory
usage are unmeasured because that renderer/cache does not exist.

The installation, installed PNGs, LocalLow data and actual saves were not modified.
The probe never consults LocalLow. No game artwork is added to source, fixtures,
installers or Web assets. Tests use synthetic data. Existing baked/source-cache
invalidation and opaque-protocol security remain unchanged. Cosmetic authorization
uses 557 explicitly approved IDs; Recharge retains its independent
29-identity evidence boundary, without new authority for this installation.

## Geometry validation

The following results describe the geometry experiment configuration.

The tests cover
transform composition/nonfinite data, projection/clip bounds, invalid indices and
topology, base vertices, decompression/read budgets, source mutation/missing files,
path escape rejection, access-time-only changes, material sentinels and worker
failure/timeout without a partial report. Existing suites protect the production
cache, protocol and capability contracts.

| Check                                               | Result                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Full Python suite                                   | 597 passed, 2 existing Windows symlink-creation skips; 25 new probe cases included                                 |
| Ruff lint / format check                            | Passed repository-wide                                                                                             |
| Mypy                                                | Passed 83 configured source files and the probe checked separately                                                 |
| `python -m tools.capabilities check`                | Passed; 29 Recharge identities, 557 approved cosmetic IDs; snapshots unchanged                                     |
| Desktop `imports:check` / ESLint / production build | Passed, no lint warnings                                                                                           |
| Desktop `npm test`                                  | 373 passed across 44 files; import and theme checks also passed                                                    |
| Desktop `bundle:check`                              | Executed successfully; existing warning: 583.03 KiB raw / 156.48 KiB gzip                                          |
| Installed asset probe                               | Passed source/provenance checks; 0/7 faithful thumbnails; three reproducible control-mask comparisons              |
| Desktop `test:e2e`                                  | 5 passed; initial test-server startup timeout resolved on sequential retry without configuration/assertion changes |
| Packaging and installer lifecycle                   | Not rerun: no product/runtime, dependencies or packaging changes                                                   |

No reconstructed cache exists, so cold preparation, warm/relaunch cache reuse,
cache corruption/invalidation and deduplication are not claimed as newly tested
renderer behavior. The existing cache tests ran in the full suites. Source changes,
missing files, malformed geometry, bounded reads and worker failure are exercised
with synthetic probe inputs. Actual game sources were never corrupted for testing.

The probe marks results `authenticThumbnail=false`: partial geometry and high
silhouette overlap cannot establish a correct thumbnail. These tests do not cover
a production renderer, reconstruction cache or game-runtime appearance.

## Full-color control

The control produces a close, repeatable RGBA baseline with residual error.
It remains a diagnostic reconstruction rather than an authenticated recovered icon.

### Exact control and source findings

Selected `Item Health Pack Small`, canonical key
`Item Health Pack Small|Item Health Pack Small`, installed baked filename
`78bcf994a25e716931a03c9722e0dd2e.png`. It has a complete visible static body:
931 vertices, 657 triangles, one submesh, normals/tangents/UV0, one Standard
material and an authored, unscaled perspective camera. This avoids the missing
cameras, procedural text and custom shaders of the seven unresolved items.

The [one-control experiment](../../tools/artwork_color_proof.py) reuses the
existing probe/readers/decoders. It rejects other geometry counts, unsupported
material modes and sampling conventions. The render function receives source
geometry, camera, material, textures and lights; it never receives reference
pixels. No camera search, registration, exposure, white-balance or light fitting
was performed.

| Aspect                | Verified source finding                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera                | PathID 1256163; position `(0.004391,0.204569,0.852257)`, quaternion `(0.000123,-0.998497,0.054758,0.002248)`, FOV 26.9914665°, near/far 0.3/1000, full viewport and zero lens shift. Camera/root transforms are composed, preserving the mesh's 0.6327226 scale and 180° orientation.                                                                                                                                                       |
| Shared lighting       | `level0` ItemManager PathID 2799 references GameObject 10, `Icon Lights`. Four enabled white, shadowless directional lights have intensity 0.600000024, with incoming directions `+X`, `-X`, `+Z`, `-Z`. Their root is authored at `(-1000,-1000,-1000)`, matching the verified capture relocation.                                                                                                                                         |
| Endian correction     | The earlier exploratory type-tree diagnostic used an EndianBinaryReader's big-endian default. The actual little-endian ItemManager data contains five empty vectors/string fields followed by local PPtr `(0,10)`. It was a diagnostic error, not missing or corrupt light data. The new bounded reader checks that exact 64-byte layout.                                                                                                   |
| Material              | `Health Packs`; installed shader `Standard`, D3D11 platform metadata; keywords `_NORMALMAP`, `_EMISSION`; opaque mode, blend One/Zero, depth writes enabled, white tint, metallic 0.5, smoothness 0.5, bump scale 1. Emission color is `(1.1486982,1.1486982,1.1486982)`.                                                                                                                                                                   |
| Sampling              | Three 512×512 textures, ten mip levels each: DXT1 albedo/emission and DXT5 normal. All specify point filtering, repeat U/V, anisotropy 1 and mip bias 0. Main UV scale/offset are identity. The full mip chains decode with exact byte coverage, but this baseline samples only mip zero.                                                                                                                                                   |
| Normal interpretation | The shader's DXT5 normal path reconstructs X from packed red × alpha and Y from green, with reconstructed Z; mesh normals use the shader's first three components even where the stored channel has four. Normal-map alpha is not surface opacity.                                                                                                                                                                                          |
| Color space/path      | Source-bound PlayerSettings prefix gives `m_ActiveColorSpace=0` (Gamma); all three graphics tiers select DeferredShading, no custom render pipeline, and linear light intensity is disabled. The full PlayerSettings native read still fails its 948/944-byte coverage check; only the independently inspected prefix at offset 244 is used, pinned to the exact source SHA below. No parser assertion or production allowlist was relaxed. |
| Alpha/composition     | The material is opaque; covered pixels output alpha 255, and clear pixels retain the camera's `(49,77,121,0)` RGBA. The genuine PNG also has only alpha 0 or 255. The authored target has eight MSAA samples, but the original effective deferred-path resolve/sample behavior is not proven. This diagnostic uses one pixel-center sample and records that limit.                                                                          |

Additional source SHA-256 values:

| Input                | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `globalgamemanagers` | `0b0c9ac3ceb81a6bc9254b51a5e93647926a59f51cc16e60e4c875d69a4035a9` |
| `level0`             | `827f60a95e205c595be5549bbd081cbe99148270b35542f1b6d889b49ba8228e` |

The exact Unity 6000.3.17f1 built-in shader source archive was retrieved from
the [official release's Shaders link](https://unity.com/releases/editor/whats-new/6000.3.17f1)
and retained only under ignored local research output. Archive SHA-256:
`76820c92624489c1cfb2e8eb01cf5d63702b44834b6e7ad03b2339f56f59f868`.
`UnityStandardBRDF`, `UnityStandardInput`, `UnityStandardUtils`, `UnityStandardCore`
and `UnityCG` establish the desktop GGX/Disney diffuse equations, gamma dielectric
reflectance, normal unpacking, metallic response, emission and opaque alpha used
by this baseline. Matching source version and shader name do not independently
prove the installed compiled runtime variant.
Unity's [Standard material reference](https://docs.unity.com/en-us/engine/6000.3/manual/materials-and-shaders/built-in/shader-built-in-birp/shader-standard-shader/standard-shader-material-parameters),
[render-texture color-space semantics](https://docs.unity3d.com/ja/current/ScriptReference/RenderTextureReadWrite.html)
and [versioned graphics enums](https://github.com/Unity-Technologies/UnityCsReference/blob/6000.3/Runtime/Export/Graphics/GraphicsEnums.cs)
support these interpretations. The serialized target's format 8 is
`R8G8B8A8_UNorm`, not HDR floating-point storage; no added output gamma transform
or tone/exposure adjustment is used.

### RGBA comparison

Comparison uses original 512×512 RGBA buffers without resizing, alignment, color
matching or reference-driven corrections. Foreground means reference alpha >0,
so transparent background pixels cannot dilute the reported foreground RGB error.
Black/white composites separately check visible color plus alpha behavior.

| Metric                                                      |                  Measured result |
| ----------------------------------------------------------- | -------------------------------: |
| RGBA RMSE, all pixels, byte scale 0–255                     |                         5.316819 |
| Reference-foreground RGB MAE, 0–255                         |                         1.772651 |
| Reference-foreground RGB RMSE, 0–255                        |                         8.661197 |
| Reference-foreground RGB PSNR                               |                     29.379245 dB |
| Alpha MAE / RMSE, 0–255                                     |              0.041828 / 3.265912 |
| Exactly matching alpha pixels                               | 99.983597% (43 differing pixels) |
| Alpha IoU at 128                                            |                        0.9996298 |
| Exactly matching complete RGBA pixels, including background |                       67.865372% |
| Black / white composite RGB RMSE, 0–255                     |              6.150087 / 5.760096 |

Local side-by-side inspection on white, plus an unamplified RGB difference image,
confirmed matching broad color, green display, emission and body shading. Visible
residuals concentrate at boundaries, thin features and texture transitions. Their
cause has not been completely isolated; they must not all be attributed to harmless
rounding. This is more evidence than a silhouette match, but no metric here is
declared an acceptance threshold.

Two independent process runs produced identical metrics and candidate PNG bytes.
Candidate PNG SHA-256 is
`13aa7ab9e2e801a25ca8dd50153cd43dac1ac0c61b17c6a8cb4550c1922dff1b`.
The candidate is a diagnostic reconstruction, not an authenticated recovered icon.
No comparison artwork is committed, included in fixtures or distributed.

### Rendering limitations

- GPU derivative/quad mip selection is not reproduced. Base-mip point sampling
  cannot establish texture-sampling fidelity on minified faces.
- Unity's deferred G-buffer and light-buffer formats, quantization and actual
  compiled shader variant are not emulated. The baseline evaluates the documented
  Standard direct equations rather than running the game's GPU programs.
- The health pack has an authored green point light at `(0,0.096,0)`, intensity 1,
  range 1. Its generated attenuation lookup and complete runtime contribution are
  not modeled. Read-only IL for `PropLight.Awake/Start` and
  `ItemHealthPack.Start/LightLogic` confirms runtime registration and used-state
  light/emission changes; it does not establish the original bake's full state.
- Capture sets white ambient light, but runtime ambient-probe refresh and
  environment reflection state are not independently reproduced.
- Binary baked alpha versus the authored eight-sample target remains an effective
  render-path/resolve question. The original baked PNG's generation device, state
  and precise pipeline are not recorded in the installation.

This control does not test Leaf Blower's scaled camera or the built-in Resources
version mismatch; those coverage limits remain. Supporting the seven missing prefabs would additionally require their
custom shaders, missing cameras and dynamic geometry/effects. Expanding this
experiment to cover those systems would exceed a bounded one-item proof and move
toward a Unity renderer.

Resolving the residual requires source-derived sampler or GPU-conformance evidence,
not camera/light fitting against the PNG. The Standard control does not establish
support for the seven missing prefabs' custom shaders or dynamic geometry.

### Running the color proof

```powershell
$env:PYTHONPATH = 'desktop/python'
uv run --isolated --python 3.13 --locked --group package --with numpy==2.4.6 python -m tools.artwork_color_proof --write-local-comparison > build/item-thumbnail-proof/color-proof.json
```

The command uses the locked UnityPy package group and NumPy 2.4.6 in an isolated
research environment. NumPy is not a production renderer dependency.
Without `--write-local-comparison`, the tool emits metadata/metrics only. With it,
images are created exclusively in a fresh directory under the repository's ignored
`build/item-thumbnail-proof/rgba-proof/`, independent of the caller's working
directory. Existing files cannot be overwritten. The JSON output identifies the local comparison directory; these files are not
product artifacts.

Both probes retain the eight-file/768-MiB native-input, 64-MiB stream-read, 16-MiB object,
512-object hierarchy and 120-second process bounds. The control additionally
requires its exact mesh counts, 512px textures/ten mip levels and 512px output; its
counted primary render buffers plus decoded mip arrays have a 64-MiB budget.

Measured color run: 0.345770 s render computation, 26.246740 s total
including source loading/validation, metrics and local PNG export; 728,896 bytes
of explicit stream reads; 32,846,088 bytes (31.33 MiB) of counted primary
buffers/mip arrays. Counts exclude temporary NumPy objects and UnityPy/native
allocations, so they are not peak process memory. OS caches were uncontrolled.
These are one-control research measurements, not production latency, warm-cache
or relaunch benchmarks. The large source-loading cost is another integration issue
to evaluate only after fidelity is established.

| Color-proof validation                                                                      | Result                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic color-proof cases                                                                 | 13 passed locally: RGBA/alpha/composite metrics, malformed inputs, unsupported material modes/UV transforms, repeat/mip sampling, depth/backface behavior, float4 normal channels, timeouts/failure, and safe local export with an untouched synthetic save |
| Full Python suite                                                                           | 610 passed, 2 existing Windows symlink skips                                                                                                                                                                                                                |
| Ruff lint / format                                                                          | Passed repository-wide                                                                                                                                                                                                                                      |
| Mypy                                                                                        | Passed 83 configured production sources and both research probes checked separately                                                                                                                                                                         |
| Capability alignment                                                                        | Passed; 29 Recharge identities, 557 approved cosmetics; evidence/snapshots unchanged                                                                                                                                                                        |
| Installed color proof                                                                       | Completed twice with identical metrics/candidate bytes; full RGBA parity remains unestablished                                                                                                                                                              |
| Full native PlayerSettings decoding                                                         | Still rejects a four-byte coverage discrepancy; no assertion suppressed, source-pinned prefix only                                                                                                                                                          |
| Application-level validation                                                                | Not run for the color proof; application results in the geometry validation table describe that configuration                                                                                                                                               |
| GPU execution, game-runtime capture, other controls and all seven missing-item color proofs | Not run                                                                                                                                                                                                                                                     |

The optional NumPy/Pillow synthetic cases ran locally; minimal environments without
those research packages can skip them. No runtime/package dependency was added to
force them into the application. The probes read installed sources without modifying game files, saves or LocalLow.
They do not participate in production protocol/cache resolution or mutation policy.
