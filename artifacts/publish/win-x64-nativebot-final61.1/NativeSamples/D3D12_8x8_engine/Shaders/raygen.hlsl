// Minimal DXR RayGen shader for preview
RaytracingAccelerationStructure Scene : register(t0);
RWTexture2D<float4> Output : register(u0);

struct RayPayload {
	float3 color;
};

[shader("raygeneration")]
void RayGen()
{
	uint2 dim; Output.GetDimensions(dim.x, dim.y);
	uint2 tid = DispatchRaysIndex().xy;
	float2 uv = (float2(tid) + 0.5) / float2(dim);
	float3 ro = float3(0.0, 1.0, -6.0);
	float2 p = uv * 2.0 - 1.0; p.x *= (float)dim.x / (float)dim.y;
	float3 rd = normalize(float3(p, 1.5));

	RayDesc ray;
	ray.Origin = ro;
	ray.Direction = rd;
	ray.TMin = 0.001;
	ray.TMax = 1e6;

	RayPayload payload;
	TraceRay(Scene, RAY_FLAG_NONE, 0xFF, 0, 1, 0, ray, payload);

	Output[tid] = float4(payload.color, 1.0);
}
