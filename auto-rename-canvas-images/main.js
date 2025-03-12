const { Plugin, PluginSettingTab, Setting } = require('obsidian');

class AutoRenamePlugin extends Plugin {
    settings = {
        targetCanvas: '', // 目标画布路径
        prefix: '01_02Houdini_' // 默认前缀
    };

    async onload() {
        console.log('加载自动重命名插件');

        // 加载保存的设置
        await this.loadSettings();

        // 添加设置选项卡
        this.addSettingTab(new AutoRenameSettingTab(this.app, this));

        this.startMonitoring();

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                this.handlePaste(evt, editor);
            })
        );
    }

    startMonitoring() {
        this.intervalId = setInterval(() => {
            this.renameImagesInActiveCanvas();
        }, 5 * 1000);
    }

    async handlePaste(evt, editor) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'canvas' || activeFile.path !== this.settings.targetCanvas) return;

        const clipboardData = evt.clipboardData;
        const items = clipboardData.items;
        let hasImage = false;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                hasImage = true;
                break;
            }
        }

        if (!hasImage) return;

        setTimeout(() => {
            this.renameImagesInActiveCanvas(true);
        }, 1500);
    }

    async renameImagesInActiveCanvas(isPasteTriggered = false) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'canvas' || activeFile.path !== this.settings.targetCanvas) return;

        try {
            const canvasContent = await this.app.vault.read(activeFile);
            const canvasData = JSON.parse(canvasContent);
            const nodes = canvasData.nodes.filter(node => 
                node.type === 'file' && 
                node.file && 
                node.file.match(/\.(png|jpg|jpeg|gif)$/i)
            );

            if (nodes.length === 0) {
                console.log('没有找到图片节点');
                if (isPasteTriggered) {
                    setTimeout(() => this.renameImagesInActiveCanvas(), 1000);
                }
                return;
            }

            const positions = nodes.map(node => {
                if (!node.file) {
                    console.warn('发现无file属性的节点:', node);
                    return null;
                }
                return {
                    id: node.id,
                    x: node.x + (node.width || 100) / 2,
                    y: node.y + (node.height || 100) / 2,
                    file: node.file
                };
            }).filter(pos => pos !== null);

            if (positions.length === 0) {
                console.log('没有有效的图片位置数据');
                if (isPasteTriggered) {
                    setTimeout(() => this.renameImagesInActiveCanvas(), 1000);
                }
                return;
            }

            const xCoords = [...new Set(positions.map(p => p.x).sort((a, b) => a - b))];
            const yCoords = [...new Set(positions.map(p => p.y).sort((a, b) => a - b))];

            const imagePositions = positions.map(pos => {
                const column = xCoords.findIndex(x => Math.abs(x - pos.x) < 1) + 1;
                const line = yCoords.findIndex(y => Math.abs(y - pos.y) < 1) + 1;
                return {
                    ...pos,
                    line,
                    column
                };
            });

            const canvasDir = activeFile.parent.path === '' ? '' : `${activeFile.parent.path}/`;

            let renamed = false;
            for (const pos of imagePositions) {
                const oldPath = pos.file;
                if (!oldPath) {
                    console.error('oldPath为空:', pos);
                    continue;
                }

                const fileName = oldPath.split('/').pop();
                if (!fileName) {
                    console.error('无法解析文件名:', oldPath);
                    continue;
                }

                const extension = fileName.split('.').pop();
                const newName = `${this.settings.prefix}L${pos.line}C${pos.column}.${extension}`;
                const newPath = `${canvasDir}${newName}`;

                if (oldPath !== newPath) {
                    console.log(`尝试重命名: ${oldPath} -> ${newPath}`);
                    try {
                        const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
                        if (!oldFile) {
                            console.error(`源文件不存在: ${oldPath}`);
                            if (isPasteTriggered) {
                                setTimeout(() => this.retryRename(oldPath, newPath, nodes), 1000);
                            }
                            continue;
                        }

                        await this.app.vault.rename(oldFile, newPath);
                        const node = nodes.find(n => n.file === oldPath);
                        if (node) {
                            node.file = newPath;
                            renamed = true;
                        } else {
                            console.warn('未找到对应节点:', oldPath);
                        }
                    } catch (e) {
                        console.error('重命名失败:', { oldPath, newPath, error: e });
                    }
                }
            }

            if (renamed) {
                await this.app.vault.modify(activeFile, JSON.stringify(canvasData));
                console.log('画布数据已更新');
            }
        } catch (e) {
            console.error('处理画布时出错:', e);
        }
    }

    async retryRename(oldPath, newPath, nodes) {
        console.log(`重试重命名: ${oldPath} -> ${newPath}`);
        const oldFile = this.app.vault.getAbstractFileByPath(oldPath);
        if (!oldFile) {
            console.error(`重试时仍未找到文件: ${oldPath}`);
            return;
        }

        try {
            await this.app.vault.rename(oldFile, newPath);
            const node = nodes.find(n => n.file === oldPath);
            if (node) {
                node.file = newPath;
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    await this.app.vault.modify(activeFile, JSON.stringify(nodes.map(n => n.file === oldPath ? node : n)));
                    console.log('重试后画布数据已更新');
                }
            }
        } catch (e) {
            console.error('重试重命名失败:', { oldPath, newPath, error: e });
        }
    }

    onunload() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        console.log('卸载自动重命名插件');
    }

    async loadSettings() {
        this.settings = Object.assign({}, this.settings, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};

// 设置界面
class AutoRenameSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: '自动重命名插件设置' });

        // 选择目标画布
        new Setting(containerEl)
            .setName('目标画布')
            .setDesc('选择要应用重命名的画布文件')
            .addDropdown(dropdown => {
                // 获取所有画布文件
                const canvasFiles = this.app.vault.getFiles().filter(file => file.extension === 'canvas');
                canvasFiles.forEach(file => {
                    dropdown.addOption(file.path, file.path);
                });
                dropdown.setValue(this.plugin.settings.targetCanvas || '');
                dropdown.onChange(async (value) => {
                    this.plugin.settings.targetCanvas = value;
                    await this.plugin.saveSettings();
                });
            });

        // 修改前缀
        new Setting(containerEl)
            .setName('文件名前缀')
            .setDesc('设置图片重命名时的前缀（例如 "01_02Houdini_"）')
            .addText(text => {
                text
                    .setPlaceholder('输入前缀')
                    .setValue(this.plugin.settings.prefix)
                    .onChange(async (value) => {
                        this.plugin.settings.prefix = value || '01_02Houdini_'; // 默认值
                        await this.plugin.saveSettings();
                    });
            });
    }
}

module.exports = AutoRenamePlugin;