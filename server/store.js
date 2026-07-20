// 存储层 facade —— 所有方法返回 Promise，调用方需 await
// 实际实现由 storage/ 模块根据环境变量自动选择（JSON 文件 / PostgreSQL）
const storage = require('./storage');
module.exports = storage;
