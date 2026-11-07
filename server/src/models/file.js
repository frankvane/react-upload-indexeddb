const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "File",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      file_id: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      file_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      size: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "test",
      },
      status: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      md5: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      category_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      file_ext: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      file_type: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      file_path: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      thumbnail_path: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
    },
    {
      tableName: "files",
      underscored: true,
      indexes: [
        // P2-9：file_id（内容分片键）按用户隔离。
        // 同一内容被不同用户上传时各自持有一条记录，避免后上传者 upsert 覆盖前者的归属。
        { unique: true, fields: ["file_id", "user_id"] },
        { fields: ["file_id"] },
        { fields: ["md5"] },
        { fields: ["status"] },
      ],
    }
  );
