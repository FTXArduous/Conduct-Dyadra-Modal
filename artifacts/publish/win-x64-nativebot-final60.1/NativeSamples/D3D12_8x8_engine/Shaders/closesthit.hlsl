struct RayPayload { float3 color; };

struct Attributes { float3 normal; };

[shader("closesthit")]
void ClosestHit(inout RayPayload payload, in Attributes attr)
{
	float3 n = normalize(attr.normal);
	float3 L = normalize(float3(1.0, 1.5, -0.5));
	float diff = max(0.0, dot(n, L));
	float3 base = float3(0.9, 0.8, 0.5);
	payload.color = base * diff + 0.05;
}
