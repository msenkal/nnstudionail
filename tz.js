// Randevu saatleri sunucunun yerel saatiyle hesaplanır. Sunucu yurt dışında / UTC'de olsa bile
// Türkiye saatini kullanmak için diğer tüm modüllerden ÖNCE içe aktarılmalıdır.
process.env.TZ = process.env.TZ || 'Europe/Istanbul';
